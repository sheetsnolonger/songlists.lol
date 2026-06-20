const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error("missing DATABASE_URL");
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  console.error("missing SESSION_SECRET");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true
});

const uploadDir = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safeName =
      Date.now() +
      "-" +
      file.originalname.replace(/[^a-z0-9._-]/gi, "_");

    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/mp4"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("only images and audio allowed"));
    }

    cb(null, true);
  }
});

app.set("view engine", "ejs");
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true, limit: "25kb" }));
app.use(express.static("public"));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https://files.catbox.moe", "data:"],
      mediaSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: "too many requests"
}));

const postLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "slow down"
});

app.use(session({
  store: new pgSession({
    pool,
    tableName: "session",
    createTableIfMissing: true
  }),
  name: "songlists.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.redirect("/admin-login");
  }

  next();
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  next();
}

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect("/admin-login");
  next();
}

function cleanText(text, maxLength) {
  return String(text || "").trim().slice(0, maxLength);
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBody(text) {
  const escaped = escapeHtml(text);

  function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}
  
  return escaped
    .split("\n")
    .map(line => {
      if (line.startsWith("&gt;") && !line.startsWith("&gt;&gt;")) {
        return `<span class="greentext">${line}</span>`;
      }

      return line.replace(
        /&gt;&gt;(\d+)/g,
        `<a class="quote-link" href="#p$1">&gt;&gt;$1</a>`
      );
    })
    .join("<br>");
}

app.locals.formatBody = formatBody;

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS boards (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS threads (
      id SERIAL PRIMARY KEY,
      board_slug TEXT NOT NULL REFERENCES boards(slug) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author TEXT DEFAULT 'anon',
      pinned BOOLEAN DEFAULT false,
      media_url TEXT,
      media_type TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS replies (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
      body TEXT,
      author TEXT DEFAULT 'anon',
      media_url TEXT,
      media_type TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_css TEXT DEFAULT '';
    
    ALTER TABLE threads ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;
    ALTER TABLE threads ADD COLUMN IF NOT EXISTS media_url TEXT;
    ALTER TABLE threads ADD COLUMN IF NOT EXISTS media_type TEXT;

    ALTER TABLE replies ADD COLUMN IF NOT EXISTS media_url TEXT;
    ALTER TABLE replies ADD COLUMN IF NOT EXISTS media_type TEXT;

    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
  `);

  const boards = [
    ["mu", "music", "general music discussion"],
    ["rok", "rock", "classic, indie, alt rock"],
    ["met", "metal", "death, black, doom, thrash"],
    ["pnk", "punk", "hardcore, crust, oi"],
    ["emo", "emo", "emo, screamo, midwest emo"],
    ["shg", "shoegaze", "dream pop, noise pop"],
    ["grg", "grunge", "90s alternative"],
    ["gth", "goth", "darkwave, gothic rock"],
    ["hip", "hip hop", "rap, trap, underground"],
    ["rnb", "r&b", "neo soul, contemporary"],
    ["pop", "pop", "mainstream and indie pop"],
    ["kpop", "k-pop", "korean pop"],
    ["jpop", "j-pop", "japanese pop"],
    ["elec", "electronic", "all electronic music"],
    ["idm", "idm", "braindance, glitch"],
    ["dnb", "drum and bass", "liquid, neuro, rollers"],
    ["dub", "dubstep", "deep dub, riddim"],
    ["tec", "techno", "warehouse, acid"],
    ["hou", "house", "deep, garage"],
    ["tra", "trance", "uplifting, psy"],
    ["hxc", "hardcore", "gabber, speedcore"],
    ["brc", "breakcore", "mashcore, lolicore"],
    ["amb", "ambient", "drone, atmospheric"],
    ["vap", "vaporwave", "mallsoft, future funk"],
    ["jaz", "jazz", "bebop, fusion"],
    ["blu", "blues", "delta, electric"],
    ["fol", "folk", "traditional, acoustic"],
    ["cty", "country", "americana"],
    ["cls", "classical", "orchestral"],
    ["ind", "industrial", "noise, ebm"],
    ["noi", "noise", "harsh noise wall"],
    ["exp", "experimental", "avant-garde"],
    ["ost", "soundtracks", "games, anime, movies"],
    ["wld", "world", "regional music"],
    ["lat", "latin", "reggaeton, salsa"],
    ["reg", "reggae", "dub, dancehall"],
    ["vin", "vinyl", "record collecting"],
    ["gear", "gear", "headphones, amps"],
    ["prod", "production", "daws, mixing, mastering"],
    ["shr", "sharing", "post music"],
    ["rec", "recommendations", "album recommendations"],
    ["cht", "charts", "lists and rankings"]
  ];

  for (const board of boards) {
    await pool.query(
      `INSERT INTO boards (slug, name, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description`,
      board
    );
  }
}

async function getAllBoards() {
  const result = await pool.query(`
    SELECT boards.*, COUNT(threads.id) AS thread_count
    FROM boards
    LEFT JOIN threads ON threads.board_slug = boards.slug
    GROUP BY boards.id
    ORDER BY boards.id ASC
  `);

  return result.rows;
}

app.get("/", async (req, res) => {
  const boards = await getAllBoards();

  const recent = await pool.query(`
    SELECT *
    FROM threads
    ORDER BY pinned DESC, id DESC
    LIMIT 30
  `);

  res.render("index", {
    boards,
    recent: recent.rows
  });
});

app.get("/signup", (req, res) => {
  res.render("signup", { error: null });
});

app.post("/signup", postLimiter, async (req, res) => {
  const username = cleanText(req.body.username, 30).toLowerCase();
  const password = String(req.body.password || "");

  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return res.render("signup", { error: "username must be 3-30 letters, numbers, or underscores" });
  }

  if (password.length < 8) {
    return res.render("signup", { error: "password must be at least 8 characters" });
  }

  const hash = await bcrypt.hash(password, 12);

  try {
    await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2)",
      [username, hash]
    );

    req.session.user = { username };
    res.redirect("/");
  } catch {
    res.render("signup", { error: "username already taken" });
  }
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", postLimiter, async (req, res) => {
  const username = cleanText(req.body.username, 30).toLowerCase();
  const password = String(req.body.password || "");

  const result = await pool.query(
    "SELECT * FROM users WHERE username = $1",
    [username]
  );

  if (!result.rows.length) {
    return res.render("login", { error: "wrong username or password" });
  }

  const ok = await bcrypt.compare(password, result.rows[0].password_hash);

  if (!ok) {
    return res.render("login", { error: "wrong username or password" });
  }

  req.session.user = { username: result.rows[0].username };
  res.redirect("/");
});

app.post("/logout", postLimiter, (req, res) => {
  req.session.user = null;
  res.redirect("/");
});


app.get("/u/:username", async (req, res) => {
  const username = cleanText(req.params.username, 30).toLowerCase();

  if (req.params.username.toLowerCase() === "anon") {
  return res.status(404).render("404");
}
  
  const user = await pool.query(
  `SELECT
    id,
    username,
    bio,
    avatar_url,
    custom_css,
    created_at
   FROM users
   WHERE username = $1`,
  [username]
);

  if (!user.rows.length) return res.status(404).render("404");

  const threads = await pool.query(
    "SELECT * FROM threads WHERE author = $1 ORDER BY id DESC LIMIT 50",
    [username]
  );

  const replies = await pool.query(
    "SELECT * FROM replies WHERE author = $1 ORDER BY id DESC LIMIT 50",
    [username]
  );

  res.render("profile", {
    profile: user.rows[0],
    threads: threads.rows,
    replies: replies.rows
  });
});

app.get("/settings/profile", requireLogin, async (req, res) => {
  const result = await pool.query(
    `SELECT id, username, bio, avatar_url, custom_css, created_at
     FROM users
     WHERE username = $1`,
    [req.session.user.username]
  );

  if (!result.rows.length) {
    req.session.user = null;
    return res.redirect("/login");
  }

  res.render("profile-settings", {
    user: result.rows[0],
    error: null
  });
});

app.post("/settings/profile", postLimiter, requireLogin, async (req, res) => {
  const bio = cleanText(req.body.bio, 500);
  const avatarUrl = cleanText(req.body.avatar_url, 500);
  const customCss = String(req.body.custom_css || "").slice(0, 3000);

  await pool.query(
    `UPDATE users
     SET bio = $1,
         avatar_url = $2,
         custom_css = $3
     WHERE username = $4`,
    [bio, avatarUrl, customCss, req.session.user.username]
  );

  res.redirect("/u/" + req.session.user.username);
});

app.get("/boards", (req, res) => {
  res.redirect("/");
});

app.get("/catalog", async (req, res) => {
  const boards = await getAllBoards();

  const threads = await pool.query(`
    SELECT threads.*, COUNT(replies.id) AS reply_count
    FROM threads
    LEFT JOIN replies ON replies.thread_id = threads.id
    GROUP BY threads.id
    ORDER BY pinned DESC, id DESC
    LIMIT 150
  `);

  res.render("catalog", {
    boards,
    threads: threads.rows
  });
});

app.get("/archive", async (req, res) => {
  const boards = await getAllBoards();

  const threads = await pool.query(`
    SELECT *
    FROM threads
    ORDER BY id DESC
    LIMIT 250
  `);

  res.render("archive", {
    boards,
    threads: threads.rows
  });
});

app.get("/admin-login", (req, res) => {
  res.render("admin-login", { error: null });
});

app.post("/admin-login", postLimiter, (req, res) => {
  if (!process.env.ADMIN_PASSWORD) {
    return res.send("ADMIN_PASSWORD is not set in Render env vars");
  }

  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.redirect("/secret-admin");
  }

  res.render("admin-login", { error: "wrong password" });
});

app.post("/admin-logout", requireAdmin, postLimiter, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/secret-admin", requireAdmin, async (req, res) => {
  res.render("admin");
});

app.get("/admin/reports", requireAdmin, async (req, res) => {
  const boards = await getAllBoards();

  const reports = await pool.query(`
    SELECT *
    FROM reports
    ORDER BY id DESC
    LIMIT 200
  `);

  res.render("admin-reports", {
    boards,
    reports: reports.rows
  });
});

app.get("/admin/threads", requireAdmin, async (req, res) => {
  const threads = await pool.query(`
    SELECT threads.*, COUNT(replies.id) AS reply_count
    FROM threads
    LEFT JOIN replies ON replies.thread_id = threads.id
    GROUP BY threads.id
    ORDER BY pinned DESC, id DESC
  `);

  res.render("admin-threads", {
    threads: threads.rows
  });
});



app.post("/admin/thread/:id/delete", requireAdmin, postLimiter, async (req, res) => {
  await pool.query("DELETE FROM threads WHERE id = $1", [req.params.id]);
  res.redirect("/secret-admin");
});

app.post("/admin/thread/:id/pin", requireAdmin, postLimiter, async (req, res) => {
  await pool.query("UPDATE threads SET pinned = true WHERE id = $1", [req.params.id]);
  res.redirect("/secret-admin");
});

app.post("/admin/thread/:id/unpin", requireAdmin, postLimiter, async (req, res) => {
  await pool.query("UPDATE threads SET pinned = false WHERE id = $1", [req.params.id]);
  res.redirect("/secret-admin");
});

app.post("/admin/reply/:id/delete", requireAdmin, postLimiter, async (req, res) => {
  await pool.query("DELETE FROM replies WHERE id = $1", [req.params.id]);
  res.redirect("/secret-admin");
});

app.post("/admin/user/:id/delete", requireAdmin, postLimiter, async (req, res) => {
  await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
  res.redirect("/secret-admin");
});

app.get("/admin/threads", requireAdmin, async (req, res) => {
  const threads = await pool.query(`
    SELECT threads.*, COUNT(replies.id) AS reply_count
    FROM threads
    LEFT JOIN replies ON replies.thread_id = threads.id
    GROUP BY threads.id
    ORDER BY pinned DESC, id DESC
  `);

  res.render("admin-threads", {
    threads: threads.rows
  });
});

app.get("/admin/replies", requireAdmin, async (req, res) => {
  const replies = await pool.query(`
    SELECT replies.*, threads.title AS thread_title, threads.board_slug
    FROM replies
    JOIN threads ON threads.id = replies.thread_id
    ORDER BY replies.id DESC
    LIMIT 200
  `);

  res.render("admin-replies", {
    replies: replies.rows
  });
});

app.get("/admin/users", requireAdmin, async (req, res) => {
  const users = await pool.query(`
    SELECT id, username, created_at
    FROM users
    ORDER BY id DESC
  `);

  res.render("admin-users", {
    users: users.rows
  });
});

app.get("/admin/reports", requireAdmin, async (req, res) => {
  const reports = await pool.query(`
    SELECT *
    FROM reports
    ORDER BY id DESC
    LIMIT 200
  `);

  res.render("admin-reports", {
    reports: reports.rows
  });
});

app.get("/:board/thread/:id", async (req, res) => {
  const boards = await getAllBoards();

  const thread = await pool.query(
    "SELECT * FROM threads WHERE id = $1 AND board_slug = $2",
    [req.params.id, req.params.board]
  );

  if (!thread.rows.length) {
    return res.status(404).render("404", { boards });
  }

  const replies = await pool.query(
    "SELECT * FROM replies WHERE thread_id = $1 ORDER BY id ASC",
    [req.params.id]
  );

  res.render("thread", {
    boards,
    board: req.params.board,
    thread: thread.rows[0],
    replies: replies.rows
  });
});

app.post("/report/reply/:id", postLimiter, async (req, res) => {
  const reason = cleanText(req.body.reason, 300);

  await pool.query(
    "INSERT INTO reports (type, target_id, reason) VALUES ($1, $2, $3)",
    ["reply", req.params.id, reason]
  );

  res.redirect(req.get("Referer") || "/");
});

app.get("/:board", async (req, res) => {
  const boards = await getAllBoards();

  const board = await pool.query(
    "SELECT * FROM boards WHERE slug = $1",
    [req.params.board]
  );

  if (!board.rows.length) {
  return res.status(404).send("board not found");
}

  const threads = await pool.query(`
    SELECT threads.*, COUNT(replies.id) AS reply_count
    FROM threads
    LEFT JOIN replies ON replies.thread_id = threads.id
    WHERE threads.board_slug = $1
    GROUP BY threads.id
    ORDER BY pinned DESC, id DESC
  `, [req.params.board]);

  res.render("board", {
    boards,
    board: board.rows[0],
    threads: threads.rows
  });
});

app.post("/:board/thread", postLimiter, upload.single("media"), async (req, res) => {
  const board = await pool.query(
    "SELECT * FROM boards WHERE slug = $1",
    [req.params.board]
  );

  if (!board.rows.length) {
  return res.status(404).render("404");
}
  const title = cleanText(req.body.title, 120);
  const body = cleanText(req.body.body, 5000);
  const author = req.session.user?.username || cleanText(req.body.author, 40) || "anon";
  const mediaUrl = req.file ? "/uploads/" + req.file.filename : null;
  const mediaType = req.file ? req.file.mimetype : null;

  if (!title || (!body && !mediaUrl)) {
    return res.send("title and post body or file required");
  }

  await pool.query(
    `INSERT INTO threads (board_slug, title, body, author, media_url, media_type)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.params.board, title, body, author, mediaUrl, mediaType]
  );

  res.redirect(`/${req.params.board}`);
});



app.post("/:board/thread/:id/reply", postLimiter, upload.single("media"), async (req, res) => {
  const thread = await pool.query(
    "SELECT * FROM threads WHERE id = $1 AND board_slug = $2",
    [req.params.id, req.params.board]
  );

  if (!thread.rows.length) {
  return res.status(404).render("404");
}
  const body = cleanText(req.body.body, 5000);

const author =
  req.session.user?.username ||
  cleanText(req.body.author, 40) ||
  "anon";

  const mediaUrl = req.file ? "/uploads/" + req.file.filename : null;
  const mediaType = req.file ? req.file.mimetype : null;

  if (!body && !mediaUrl) return res.send("reply or file required");

  await pool.query(
    `INSERT INTO replies (thread_id, body, author, media_url, media_type)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.params.id, body, author, mediaUrl, mediaType]
  );

  res.redirect(`/${req.params.board}/thread/${req.params.id}`);
});

app.use((err, req, res, next) => {
  console.error("upload/server error:", err);

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).send("file too large. max is 100mb.");
}

  if (err.message === "only images and audio allowed") {
    return res.status(400).send("only images and audio allowed.");
  }

  res.status(500).send(err.message || "server error");
});

app.use((req, res) => {
  res.status(404).render("404");
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log("songlists running on port " + PORT);
    });
  })
  .catch((err) => {
    console.error("failed to start app");
    console.error(err);
    process.exit(1);
  });
