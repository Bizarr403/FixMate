import express from "express";
import pg from "pg";
import passport from "passport";
import bcrypt, { hash } from "bcrypt";
import env from "dotenv";
import { Strategy } from "passport-local";
import bodyParser from "body-parser";
import session from "express-session";
import fs from "fs";
env.config();
const app = express();
const port = 3000;
const saltRounds = 10;

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static("public"));

app.use(bodyParser.urlencoded({ extended: true }));
const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();
app.get("/", (req, res) => {
  res.render("home.ejs");
});
app.get("/dashboard", async (req, res) => {
  if (req.isAuthenticated) {
    const result = await db.query("SELECT * FROM halls");
    const hall = result.rows;
    res.render("admin_dash.ejs", { hall: hall });
  } else {
    res.redirect("/halladmin/signup");
  }
});
app.get("/viewproblems/:hall", async (req, res) => {
  if (req.isAuthenticated) {
    const hall = req.params.hall;

    const halls = await db.query("SELECT hall FROM halladmin WHERE hall = $1", [
      hall,
    ]);

    const problems = await db.query("SELECT * FROM problems WHERE hall = $1", [
      hall,
    ]);

    const hallProblems = problems.rows;

    res.render("admin.ejs", { problems: hallProblems, hall: hall });
  } else {
    res.redirect("/halladmin/signup");
  }
});
app.get("/halls", async (req, res) => {
  if (req.isAuthenticated) {
    const result = await db.query("SELECT * FROM halls");
    const hall = result.rows;
    res.render("halls.ejs", { hall: hall });
  } else {
    res.redirect("/halladmin/signup");
  }
});

//hall admin signup and login get and post methods
app.get("/halladmin/signup", (req, res) => {
  res.render("halladmin_signup.ejs");
});
app.post("/halladmin/signup", async (req, res) => {
  const name = req.body.fullname;
  const staffid = req.body.staffid;
  const password = req.body.password;
  const hall = req.body.hall;
  try {
    const result = await db.query(
      "SELECT * FROM halladmin WHERE staffid = $1",
      [staffid]
    );
    if (result.rows.length > 0) {
      res.redirect("/halladmin/login");
    } else {
      const hashedPassword = bcrypt.hash(
        password,
        saltRounds,
        async (err, hash) => {
          if (err) {
            console.log("Error hashing the password", err);
          } else {
            const result = await db.query(
              "INSERT INTO halladmin(name, staffid, hall, password) VALUES ($1, $2, $3, $4)",
              [name, staffid, hall, hash]
            );
            await db.query(
              "UPDATE halls SET admin_id = $1 WHERE name LIKE %||$2||%",
              [hall]
            );
            const halladmin = result.rows[0];
            req.login(halladmin, (err) => {
              console.log("success");
              res.redirect("/halladmin/login");
            });
          }
        }
      );
    }
  } catch (error) {
    console.log(error);
  }
});
app.get("/halladmin/login/:name", (req, res) => {
  const hall = req.params.name;
  res.render("halladmin_login.ejs", { hall: hall });
});
app.post(
  "/halladmin/login/:hall",
  passport.authenticate("localhalladmin", {
    successRedirect: "/dashboard",
    failureRedirect: "/halladmin/login/:hall",
  })
);
app.get("/print/:hall", async (req, res) => {
  const hall = req.params.hall;
  const halls = await db.query("SELECT hall FROM halladmin WHERE hall = $1", [
    hall,
  ]);

  const halladminHall = halls.rows[0].hall;

  const problems = await db.query("SELECT * FROM problems WHERE hall = $1", [
    hall,
  ]);

  const hallProblems = problems.rows;
  let fileContent =
    "Room|\tCategory|\tDescription|\t\tDate Submitted|\tSubmitted By\t\n";

  // Loop through problems and write each one to the file
  hallProblems.forEach((problem) => {
    // Write problem details in tab-separated format
    const problemData = `${problem.room}|\t${problem.category}|\t${problem.description}|\t\t${problem.datesubmitted}|\t${problem.student_id}\n`;
    fileContent += problemData;
  });
  fs.writeFileSync(
    // Write the headers at the top of the file
    `${hall} problem.txt`,
    fileContent
  );
  res.redirect(`/viewproblems/${halladminHall}`);
});
//student signup and login get and post methods
app.get("/student/signup", (req, res) => {
  res.render("student_signup.ejs");
});

app.post("/student/signup", async (req, res) => {
  const name = req.body.fname;
  const matno = req.body.matno;
  const password = req.body.password;
  try {
    const result = await db.query("SELECT * FROM students WHERE matno = $1", [
      matno,
    ]);
    if (result.rows.length > 0) {
      res.redirect("/student/login");
    } else {
      const hashedPassword = bcrypt.hash(
        password,
        saltRounds,
        async (err, hash) => {
          if (err) {
            console.log(err);
          } else {
            const result = await db.query(
              "INSERT INTO students (name, matno, password) VALUES ($1, $2, $3)",
              [name, matno, hash]
            );
            const student = result.rows[0];
            req.login(student, (err) => {
              console.log("success");
              res.redirect("/problems");
            });
          }
        }
      );
    }
  } catch (error) {
    console.log(error);
  }
});
app.get("/student/login", async (req, res) => {
  res.render("student_login.ejs");
});
app.post(
  "/student/login",
  passport.authenticate("localstudent", {
    successRedirect: "/problems",
    failureRedirect: "/student/signup",
  })
);
app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

//problem submission get and post
app.get("/problems", (req, res) => {
  if (req.isAuthenticated) {
    res.render("problem.ejs");
  } else {
    res.redirect("/student/login");
  }
});
app.post("/problems", async (req, res) => {
  if (req.isAuthenticated()) {
    const hall = req.body.hall;
    const room = req.body.room;
    const category = req.body.category;
    const desc = req.body.desc;
    const date = new Date();
    const student_id = req.user.matno;
    //const matno = db.query("SELECT matno FROM students WHERE matno = $1", [
    //student_id,
    //]);
    try {
      await db.query(
        "INSERT INTO problems(hall, room, category, description, datesubmitted, student_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [hall, room, category, desc, date, student_id]
      );
      console.log("Success!");
      res.redirect("/problems");
    } catch (err) {
      console.log(err);
    }
  } else {
    res.redirect("/student/login");
  }
});
//passport for student login
passport.use(
  "localstudent",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM students WHERE matno= $1", [
        username,
      ]);
      if (result.rows.length > 0) {
        const student = result.rows[0];
        const storedPassword = student.password;

        bcrypt.compare(password, storedPassword, async (err, valid) => {
          if (err) {
            console.log("Error comparing passwords", err);
            cb(err);
          } else {
            if (valid) {
              await db.query(
                "UPDATE students SET logged_in = true WHERE matno = $1",
                [username]
              );
              return cb(null, student);
            } else {
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

passport.serializeUser((student, cb) => {
  cb(null, student);
});
passport.deserializeUser((student, cb) => {
  cb(null, student);
});

passport.use(
  "localhalladmin",
  new Strategy({ passReqToCallback: true }, async function verify(
    req,
    username,
    password,
    cb
  ) {
    const hall = req.params.hall;
    try {
      const result = await db.query(
        "SELECT * FROM halladmin WHERE staffid = $1",
        [username]
      );
      if (result.rows.length > 0) {
        const halladmin = result.rows[0];
        const storedPassword = halladmin.password;
        if (halladmin.hall == hall) {
          bcrypt.compare(password, storedPassword, (err, valid) => {
            if (err) {
              console.log("Error comparing passwords:", err);
              return cb(err);
            } else {
              if (valid) {
                return cb(null, halladmin);
              } else {
                return cb(null, false);
              }
            }
          });
        }
      } else {
        return cb("User not found");
      }
    } catch (error) {
      console.log(error);
    }
  })
);

passport.serializeUser((halladmin, cb) => {
  cb(null, halladmin);
});
passport.deserializeUser((halladmin, cb) => {
  cb(null, halladmin);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
