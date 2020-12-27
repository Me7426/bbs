const express = require('express')

const apiRouter = express.Router()

module.exports = apiRouter

let db
const dbPromise = require('./bbs-db.js')

dbPromise.then(value => {
  db = value
})

// GET /api/posts  获取所有帖子
// GET /api/post/:id 获取指定帖子及相关评价
// POST /api/post 发贴
// POST /api/comment {}
// DELETE /api/comment/:id

apiRouter.get('/posts', async (req, res, next) => {
  var posts = await db.all('SELECT posts.rowid as id, * FROM posts JOIN users ON posts.userId=users.rowid')

  res.json(posts)
})

apiRouter.get('/post/:id', async (req, res, next) => {
  var postId = req.params.id

  var post = await db.get(
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
  )

  if (post) {
    var comments = await db.all(
      `SELECT comments.rowid as id, * FROM comments JOIN users ON userId = users.rowid WHERE postId = ? ORDER BY createdAt DESC`,
      postId
    )

    var data = {
      post: post,
      comments: comments,
      user: req.user,//当前已登陆用户
    }

    res.json(data)
  } else {
    res.status(404)
    res.end()
  }
})

apiRouter.post('/post', async (req, res, next) => {
  if (!req.user) {
    res.end({
      code: -1,
      msg: '未登陆无法发贴'
    })
    return
  }

  var post = req.body

  console.log('收到发贴请求', post)

  await db.run(
    'INSERT INTO posts VALUES (?, ?, ?, ?)',
    [post.title, post.content, new Date().toISOString(), req.user.id]
  )

  var post = await db.get('SELECT rowid as id, * FROM posts ORDER BY rowid DESC LIMIT 1')
  res.json(post)
})

apiRouter.post('/comment', async (req, res, next) => {
  var comment = req.body

  if (req.user) {
    await db.run(
      `INSERT INTO comments VALUES (?, ?, ?, ?)`,
      [comment.postId/*回复哪个帖子*/, req.user.id/*当前登陆用户的id*/, comment.content, new Date().toISOString()]
    )
    var comment = await db.get('SELECT rowid as id, * FROM comments ORDER BY rowid DESC LIMIT 1')
    res.json(comment)
  } else {
    res.json({ code: -1, msg: '未登陆' })
  }
})

apiRouter.delete('/comment/:id', async (req, res, next) => {
  if (req.user) {
    var comment = await db.get('SELECT * FROM comments WHERE rowid = ?', req.params.id)
    if (comment.userId == req.user.id) {
      await db.run('DELETE FROM comments WHERE rowid = ?', req.params.id)
      res.json({
        code: 0,
        msg: '删除成功'
      })
    } else {
      res.json({
        code: 1,
        msg: '权限不足，该评论并非登陆用户所发'
      })
    }
  } else {
    res.json({
      code: 1,
      msg: '用户未登陆'
    })
  }
})
