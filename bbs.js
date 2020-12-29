const express = require("express");
//const open = require('open')
const cookieParser = require("cookie-parser");
const multer = require("multer");
const fsp = require("fs").promises;
const path = require("path");
const svgCaptcha = require("svg-captcha");
const apiRouter = require("./bbs-api-router");
const cors = require("cors");

const uploader = multer({ dest: __dirname + "/uploads/" });

const app = express();
const defPort = 8080;
const IP = '0.0.0.0'

let db;
const dbPromise = require("./bbs-db.js");

dbPromise.then((value) => {
  db = value;
});

app.locals.pretty = true;
app.set("views", __dirname + "/views");
app.set('trust proxy', 'loopback')

app.use((req, _res, next) => {
  console.log(`[${req.ip}]`, req.method, req.url);
  next();
});

// app.use((req, res, next) => {
//   req.on('data', data => {
//     console.log(data.toString())
//   })
// })

app.use(
  cors({
    maxAge: 86400,
    origin: true,
    credentials: true,
  })
);

app.use(express.static(__dirname + "/static"));
app.use("/uploads", express.static(__dirname + "/uploads"));
app.use(express.json()); //Content-Type: application/json
app.use(express.urlencoded({ extended: true })); //Content-Type: application/x-www-form-urlencoded
app.use(cookieParser("lkjweoij2o3i409e"));

let sessionStore = Object.create(null);

app.use(function sessionMW(req, res, next) {
  const sessionId = req.cookies.sessionId
  if (sessionId) {
    sessionStore[sessionId] = sessionStore[sessionId] ?? {};
    req.session = sessionStore[sessionId];
    //if (!req.session) {
    //req.session = sessionStore[req.cookies.sessionId] = {}
    //}
  } else {
    let id = Math.random().toString(16).slice(2);

    req.session = sessionStore[id] = {};

    res.cookie("sessionId", id, {
      maxAge: 86400000,
    });
  }

  next();
});

app.use(async (req, _res, next) => {
  // 从签名cookie中找出该用户的信息并挂在req对象上以供后续的中间件访问
  if (req.signedCookies.user) {
    req.user = await db.get(
      "SELECT * FROM user WHERE name = ?",
      req.signedCookies.user
    );
  }

  next();
});

app.use("/api", apiRouter);

// 首页
app.get("/", async (req, res) => {
  let posts = await db.all(
    "SELECT posts.rowid as id, * FROM posts JOIN users ON posts.userId=users.rowid"
  );
  //let posts = await db.all('SELECT posts.rowid as id, * FROM posts JOIN users ON userId=users.rowid')
  res.render("index.pug", {
    user: req.user, //当前已经登陆的用户的信息对象
    posts: posts,
  });
});

// 帖子详情
app.get("/post/:id", async (req, res) => {
  let postId = req.params.id;

  let post = await db.get(
    `SELECT
      posts.rowid AS id,
      title,
      content,
      createdAt,
      userId,
      name,
      avatar
    FROM posts JOIN user ON userId = user.id
    WHERE posts.rowid = ?`,
    postId
  );

  if (post) {
    let comments = await db.all(
      `SELECT comments.rowid as id, * FROM comments JOIN users ON userId = users.rowid WHERE postId = ? ORDER BY createdAt DESC`,
      postId
    );
console.log(comments)
    let data = {
      post: post,
      comments: comments,
      user: req.user, //当前已登陆用户
    };

    res.render("post.pug", data);
  } else {
    res.status(404);
    res.render("404.pug");
  }
});

// 发贴
app
  .route("/post")
  // 发贴页面
  .get((req, res) => {
    res.render("add-post.pug", {
      user: req.user,
    });
  })
  // 提交发贴
  .post(async (req, res) => {
    if (!req.user) {
      res.end("未登陆无法发贴");
      return;
    }

    let post = req.body;

    console.log("收到发贴请求", post);

    await db.run("INSERT INTO posts VALUES (?, ?, ?, ?, ?)", [
      post.title,
      post.content,
      new Date().toISOString(),
      req.user.id,
      0
    ]);

    post = await db.get(
      "SELECT rowid as id, * FROM posts ORDER BY rowid DESC LIMIT 1"
    );

    res.redirect("/post/" + post.id); //为浏览器发送跳转的Header
  });

app.post("/comment", async (req, res) => {
  console.log("收到评论请求", req.body);

  let comment = req.body;

  if (req.user) {
    await db.run(`INSERT INTO comments VALUES (?, ?, ?, ?)`, [
      comment.postId /*回复哪个帖子*/,
      req.user.id /*当前登陆用户的id*/,
      comment.content,
      new Date().toISOString(),
    ]);
    await db.run(`UPDATE posts SET comment_count = comment_count + 1 WHERE rowid = ?`,
      comment.postId
    )

    res.redirect("/post/" + comment.postId);
  } else {
    res.end("未登陆");
  }
});

app.get("/delete-comment/:id", async (req, res) => {
  if (req.user) {
    let comment = await db.get(
      "SELECT * FROM comments WHERE rowid = ?",
      req.params.id
    );
    if (comment.userId == req.user.id) {
      await db.run("DELETE FROM comments WHERE rowid = ?", req.params.id);
      await db.run(`UPDATE posts SET comment_count = comment_count - 1 WHERE rowid = ?`,
      comment.postId
    )
      res.json({
        code: 0,
        msg: "删除成功",
      });
    } else {
      res.json({
        code: 1,
        msg: "权限不足，该评论并非登陆用户所发",
      });
    }
  } else {
    res.json({
      code: 1,
      msg: "用户未登陆",
    });
  }
});

app
  .route("/register")
  .get((_req, res) => {
    res.render("register.pug");
  })
  .post(uploader.single("avatar"), async (req, res) => {
    let user = req.body;
    let file = req.file;
    let avatarOnlineUrl = '/uploads/default-avatar.png'

    if (file) {
      let targetName = file.path + "-" + file.originalname;
      await fsp.rename(file.path, targetName);
      avatarOnlineUrl = "/uploads/" + path.basename(targetName);
    }

    try {
      await db.run(`INSERT INTO users VALUES (?, ?, ?, ?)`, [
        user.name,
        user.password,
        user.email,
        avatarOnlineUrl,
      ]);
      res.render("register-result.pug", {
        result: "注册成功",
        code: 0,
        user,
      });
    } catch (e) {
      res.render("register-result.pug", {
        result: "注册失败: " + e.toString(),
        code: 0,
      });
    }
  });

// /username-conflict-check?name=lily
// 用户名冲突检测接口
app.get("/username-conflict-check", async (req, res) => {
  let user = await db.get("SELECT * FROM users WHERE name = ?", req.query.name);

  if (user) {
    res.json({
      code: 1,
      msg: "用户名已被占用",
    });
  } else {
    res.json({
      code: 0,
      msg: "用户名可用",
    });
  }
});

//获取验证码图片

app.get("/captcha", function (req, res) {
  let captcha = svgCaptcha.create({height: 35});
  req.session.captcha = captcha.text;

  res.type("svg");
  res.status(200).send(captcha.data);
});

// app.get('/captcha', async (req, res, next) => {
//   let captcha = Math.random().toString().slice(2, 6)

//   req.session.captcha = captcha

//   res.type('image/svg+xml')

//   res.send(`
//     <svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" version="1.1">
//       <text  x="0" y="15" fill="red">${captcha}</text>
//     </svg>
//   `)
// })

app
  .route("/login")
  // 打开登陆界面
  .get((req, res) => {
    res.render("login.pug", {
      previousUrl: req.get("referer"),
    });
  })
  // 点击登陆按钮
  .post(async (req, res) => {
    console.log("收到登陆请求", req.body);
    const loginInfo = req.body;
    const captcha = req.session.captcha?.toLowerCase();

    if (loginInfo.captcha.toLowerCase() !== captcha) {
      res.json({
        code: 1,
        msg: "验证码错误",
      });
      return;
    }

    let user = await db.get(
      "SELECT * FROM users WHERE name = ? AND password = ?",
      [loginInfo.name, loginInfo.password]
    );

    console.log(req.get("referer"));

    if (user) {
      res.cookie("user", user.name, {
        maxAge: 86400000,
        signed: true,
      });
      res.json({
        code: 0,
        msg: "登陆成功",
        // return_url: req.get('referer'),
      });
    } else {
      res.json({
        code: 1,
        msg: "登陆失败，用户名或密码错误",
      });
    }
  });

// 由更改密码的id映射到对应的用户
let changePasswordMap = {};

app
  .route("/forgot")
  .get((_req, res) => {
    res.render("forgot.pug");
  })
  .post(async (req, res) => {
    let email = req.body.email;
    let user = await db.get("SELECT * FROM users WHERE email = ?", email);
    if (user) {
      let changePasswordId = Math.random().toString(16).slice(2);

      changePasswordMap[changePasswordId] = user;
      setTimeout(() => {
        delete changePasswordMap[changePasswordId];
      }, 1000 * 60 * 10);

      let changePasswordLink =
        "http://localhost:8081/change-password/" + changePasswordId;

      console.log(changePasswordLink);
      res.end(
        "A link has send to you email, open your Inbox and click the link to change password."
      );
      console.log(changePasswordMap);
      // sendEmail(email, `
      //   请点击些链接以修改密码：
      //   ${changePasswordLink}
      //   如果以上链接不能点击，请复制到浏览器后打开。
      //   该链接10分钟内有效
      // `)
      // sendTextMsg(13888888888, '您的验证码是 [${323423}]  fasldflaksjdfasdflk')
    } else {
      res.end("this email is not a registerd email in this site");
    }
  });

app
  .route("/change-password/:id")
  .get(async (req, res) => {
    let user = changePasswordMap[req.params.id];
    if (user) {
      res.render("change-password.pug", {
        user: user,
      });
    } else {
      res.end("link has expired");
    }
  })
  .post(async (req, res) => {
    let user = changePasswordMap[req.params.id];
    await db.run(
      "UPDATE users SET password = ? WHERE name = ?",
      req.body.password,
      user.name
    );
    delete changePasswordMap[req.params.id];
    res.end("password change success!");
  });

app.get("/logout", (_req, res) => {
  res.clearCookie("user");
  res.redirect("/");
});

app.get("/user/:id", async (req, res) => {
  let userInfo = await db.get(
    "SELECT * FROM users WHERE rowid = ?",
    req.params.id
  );

  if (userInfo) {
    let userPostsPromise = db.all(
      "SELECT rowid as id, * FROM posts WHERE userId = ? ORDER BY createdAt DESC",
      req.params.id
    );
    let userCommentsPromise = db.all(
      "SELECT postId, title as postTitle, comments.content, comments.createdAt FROM comments JOIN posts ON postId = posts.rowid WHERE comments.userId = ? ORDER BY comments.createdAt DESC",
      req.params.id
    );
    let [userPosts, userComments] = await Promise.all([
      userPostsPromise,
      userCommentsPromise,
    ]);

    res.render("user-profile.pug", {
      user: req.user,

      userInfo,
      userPosts,
      userComments,
    });
  } else {
    res.end("查无此人");
  }
});

//app.listen(port, '127.0.0.1', () => {
//console.log('server listening on port', port)
//// open('http://localhost:' + port)
//})

function listen(port) {
  app
    .listen(port, IP, () => {
      console.log("Server listening on port", port);
    })
    .on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        console.log(`Port ${port} is in use`);
        listen(++port);
      } else {
        throw e;
      }
    });
}

listen(defPort);
