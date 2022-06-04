import express from 'express'
import path from 'path'
import cors from 'cors'
import sockjs from 'sockjs'
import { renderToStaticNodeStream } from 'react-dom/server'
import React from 'react'
import { nanoid } from 'nanoid'

import cookieParser from 'cookie-parser'
import config from './config'
import Html from '../client/html'

const { readFile, writeFile } = require('fs').promises

require('colors')

let Root
try {
  // eslint-disable-next-line import/no-unresolved
  Root = require('../dist/assets/js/ssr/root.bundle').default
} catch {
  console.log('SSR not found. Please run "yarn run build:ssr"'.red)
}

const template = {
  taskId: '',
  title: '',
  status: 'new',
  _isDeleted: false,
  _createdAt: 0,
  _deletedAt: 0
}

const toWriteFile = (task, category) => {
  const taskBody = JSON.stringify(task)
  return writeFile(`${__dirname}/task/${category}.json`, taskBody, {encoding: 'utf-8'})
}

const toReadFile = (category) => {
  return readFile(`${__dirname}/task/${category}.json`, {encoding: 'utf-8'}).then((task) => 
   JSON.parse(task)
  )
}

const filteringRemoteTasks = (tasks) => {
  return tasks
    .filter((task) => !task._deletedAt)
      .map((obj) => {
        return Object.keys(obj)
          .reduce((acc, key) =>{
            if (key[0] !== '_') {
              return { ...acc, [key]: obj[key]}
            }
            return acc
          }, {})
      })
}

let connections = []

const port = process.env.PORT || 8090
const server = express()

const middleware = [
  cors(),
  express.static(path.resolve(__dirname, '../dist/assets')),
  express.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }),
  express.json({ limit: '50mb', extended: true }),
  cookieParser()
]

middleware.forEach((it) => server.use(it))

server.post('/api/v1/tasks/:category', async (req, res) => {
 const { category } = req.params
 const { title } = req.body
 const newTask = {
   ...template,
    taskId: nanoid(),
    title,
    _createdAt: +new Date(),
 }
 const addTask = await toReadFile(category)
  .then((taskList) => {
    const list = [...taskList, newTask]
    toWriteFile(list, category)
    return list
  })
  .catch( async() => {
    await toWriteFile([newTask, category])
    return [newTask]
  })
  res.json(addTask)
})

server.get('/api/v1/tasks/:category', async (req, res) => {
  const category = req.params
  const dataTask = await toReadFile(category)
    .then((data) => filteringRemoteTasks(data))
    .catch(() => {
      res.send('Err, 404')
      res.end()
    })
  res.json(dataTask)
})

server.get('/api/v1/tasks/:category/:timespan', async (req, res) => {
  const { category, timespan } = req.params
  const time = {
    day: 86400000,
    week: 604800000,
    month: 2592000000
  }

  const keys = Object.keys(time)
  const index = keys.indexOf(timespan)
  if (index < 0) {
    res.status('404')
    res.end()
  }

  const data = await toReadFile(category)
    .then((file) => {
      return file.filter((task) => {
        return task._createdAt + time[timespan] > +new Date()
      })
    })
    .then((filter) => {
      return filteringRemoteTasks(filter)
    })
    .catch(() => {
      res.status(404)
      res.end()
    })
  res.json(data)
})

server.use('/api/', (req, res) => {
  res.status(404)
  res.end()
})

const [htmlStart, htmlEnd] = Html({
  body: 'separator',
  title: 'Skillcrucial'
}).split('separator')

server.get('/', (req, res) => {
  const appStream = renderToStaticNodeStream(<Root location={req.url} context={{}} />)
  res.write(htmlStart)
  appStream.pipe(res, { end: false })
  appStream.on('end', () => {
    res.write(htmlEnd)
    res.end()
  })
})

server.get('/*', (req, res) => {
  const appStream = renderToStaticNodeStream(<Root location={req.url} context={{}} />)
  res.write(htmlStart)
  appStream.pipe(res, { end: false })
  appStream.on('end', () => {
    res.write(htmlEnd)
    res.end()
  })
})

const app = server.listen(port)

if (config.isSocketsEnabled) {
  const echo = sockjs.createServer()
  echo.on('connection', (conn) => {
    connections.push(conn)
    conn.on('data', async () => {})

    conn.on('close', () => {
      connections = connections.filter((c) => c.readyState !== 3)
    })
  })
  echo.installHandlers(app, { prefix: '/ws' })
}
console.log(`Serving at http://localhost:${port}`)
