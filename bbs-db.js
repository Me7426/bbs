const sqlite = require('sqlite')
const sqlite3 = require('sqlite3')
const fs = require('fs')

const dbBackup = __dirname + '/bbs.db.backup'
const dbPath = __dirname + '/bbs.db'

try {
  console.log('Check database...')
  fs.accessSync(dbPath)
} catch (e) {
  if (e.code === 'ENOENT') {
    fs.copyFileSync(dbBackup, dbPath)
  } else {
    throw e
  }
}

module.exports = sqlite.open({
  filename: dbPath,
  driver: sqlite3.Database
})
