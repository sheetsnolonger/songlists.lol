const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error("missing DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false
}));

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect("/admin-login");
  next();
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS boards (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id SERIAL PRIMARY KEY,
      board_slug TEXT NOT NULL REFERENCES boards(slug) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author TEXT DEFAULT 'anon',
      pinned BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS replies (
      id SERIAL PRIMARY KEY,
      thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      author TEXT DEFAULT 'anon',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE threads ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;
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

/* homepage */

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

/* extra pages */

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

/* admin */

app.get("/admin-login", (req, res) => {
  res.render("admin-login", { error: null });
});

app.post("/admin-login", (req, res) => {
  if (!process.env.ADMIN_PASSWORD) {
    return res.send("ADMIN_PASSWORD is not set in Render env vars");
  }

  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.redirect("/secret-admin");
  }

  res.render("admin-login", { error: "wrong password" });
});

app.post("/admin-logout", requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/secret-admin", requireAdmin, async (req, res) => {
  const boards = await getAllBoards();

  const threads = await pool.query(`
    SELECT threads.*, COUNT(replies.id) AS reply_count
    FROM threads
    LEFT JOIN replies ON replies.thread_id = threads.id
    GROUP BY threads.id
    ORDER BY pinned DESC, id DESC
  `);

  const replies = await pool.query(`
    SELECT replies.*, threads.title AS thread_title, threads.board_slug
    FROM replies
    JOIN threads ON threads.id = replies.thread_id
    ORDER BY replies.id DESC
    LIMIT 100
  `);

  res.render("admin", {
    boards,
    threads: threads.rows,
    replies: replies.rows
  });
});

app.post("/admin/thread/:id/delete", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM threads WHERE id = $1", [req.params.id]);
  res.redirect("/secret-admin");
});

app.post("/admin/thread/:id/pin", requireAdmin, async (req, res) => {
  await pool.query("UPDATE threads SET pinned = true WHERE id = $1", [req.params.id]);
  res.redirect("/secret-admin");
});

app.post("/admin/thread/:id/unpin", requireAdmin, async (req, res) => {
  await pool.query("UPDATE threads SET pinned = false WHERE id = $1", [req.params.id]);
  res.redirect("/secret-admin");
});

app.post("/admin/reply/:id/delete", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM replies WHERE id = $1", [req.params.id]);
  res.redirect("/secret-admin");
});

/* board pages */

app.get("/:board", async (req, res) => {
  const boards = await getAllBoards();

  const board = await pool.query(
    "SELECT * FROM boards WHERE slug = $1",
    [req.params.board]
  );

  if (!board.rows.length) return res.status(404).send("board not found");

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

app.post("/:board/thread", async (req, res) => {
  const board = await pool.query(
    "SELECT * FROM boards WHERE slug = $1",
    [req.params.board]
  );

  if (!board.rows.length) return res.status(404).send("board not found");

  const title = req.body.title?.trim();
  const body = req.body.body?.trim();
  const author = req.body.author?.trim() || "anon";

  if (!title || !body) return res.send("title and body required");

  await pool.query(
    `INSERT INTO threads (board_slug, title, body, author)
     VALUES ($1, $2, $3, $4)`,
    [req.params.board, title, body, author]
  );

  res.redirect(`/${req.params.board}`);
});

app.get("/:board/thread/:id", async (req, res) => {
  const boards = await getAllBoards();

  const thread = await pool.query(
    "SELECT * FROM threads WHERE id = $1 AND board_slug = $2",
    [req.params.id, req.params.board]
  );

  if (!thread.rows.length) return res.status(404).send("thread not found");

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

app.post("/:board/thread/:id/reply", async (req, res) => {
  const thread = await pool.query(
    "SELECT * FROM threads WHERE id = $1 AND board_slug = $2",
    [req.params.id, req.params.board]
  );

  if (!thread.rows.length) return res.status(404).send("thread not found");

  const body = req.body.body?.trim();
  const author = req.body.author?.trim() || "anon";

  if (!body) return res.send("reply required");

  await pool.query(
    "INSERT INTO replies (thread_id, body, author) VALUES ($1, $2, $3)",
    [req.params.id, body, author]
  );

  res.redirect(`/${req.params.board}/thread/${req.params.id}`);
});

/* start */

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
