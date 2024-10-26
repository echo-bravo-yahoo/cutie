import fetch from 'node-fetch'
import shuffle from 'shuffle-array'
import * as f from './filters.js'

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const secrets = require('./secrets')
import { wrap } from './helpers.js'

async function getTasks() {
  let res = await fetch('https://app.wingtask.com:53589', {
    headers: {
      Authorization: secrets.task.token
    }
  })

  res = await res.json()

  // take some optional params and ensure they exist
  const safeData = res.map((task) => {
    let _tags, _annotations
    task.tags ? _tags = task.tags : _tags = []
    task.annotations ? _annotations = task.annotations : _annotations = []
    return { ...task, tags: _tags, annotations: _annotations }
  })
  return safeData
}

function getRandomArbitrary(min, max) {
    return Math.random() * (max - min) + min
}

function filterTasks(tasks) {
  // we probably shouldn't show tasks that are blocked
  // on dependency or negative urgency
  return tasks
    .filter((task) => !task.depends)
    .filter((task) => task.urgency > 0)
}

// this currently works on just 1 task at a time, but could be extended
// to instead work on a certain number of tasks
function weightedDraw(tasks) {
  const totalUrgency = filterTasks(tasks)
    .map((task) => task.urgency)
    .reduce((acc, urgency) => acc += urgency, 0)

  const random = getRandomArbitrary(0, totalUrgency)

  // dumb declarative stuff because javascript doesn't support
  // short-circuiting a reduce function, and at least this
  // is readable
  let remainingUrgency = random,
      index = 0
  while(remainingUrgency > 0) {
    remainingUrgency -= tasks[index].urgency
    index++
  }

  // console.log('Drew index', index, 'from a total urgency of', totalUrgency, 'which evaluates to task', tasks[index - 1])

  return tasks[index - 1]
}

// take in a set of matches and others and config
// return a filtered set of matches and others
function chunk(firstArg, config) {
  // firstArg could be an array of others, or an object { matches: [], others: [] }
  let others, matches, possibilities

  // this happens on the first chunk call to kick off a chain
  if (firstArg.length) {
    others = firstArg
    matches = []
  } else {
    others = firstArg.others
    matches = firstArg.matches
  }

  possibilities = config.filter ? config.filter(others) : others
  // console.log('pre strategy:', 'matches', matches.length, 'others', others.length, 'possibilities', possibilities.length)


  let newMatches = [], maxLength = possibilities.length
  if (config.strategy === 'next') {
    let sorted = possibilities.sort((a, b) => b.urgency - a.urgency)

    newMatches = sorted.slice(0, config.limit)
    others = others.filter((other) => sorted.find((sort) => sort.id !== other.id))

    // console.log('next strategy:', 'matches', ([...matches, ...newMatches]).length, 'others', others.length, 'possibilities', possibilities.length)

    return { matches: [ ...matches, ...newMatches], others }
  } else if (config.strategy === 'shuffle') {

    for(let i = 0; i < Math.min(config.limit, maxLength); i++) {
      const newMatch = weightedDraw(possibilities)
      newMatches.push(newMatch)
      others = others.filter((task) => task.id !== newMatch.id)
      possibilities = possibilities.filter((task) => task.id !== newMatch.id)
    }

    // console.log('shuffle strategy:', 'matches', ([ ...matches, ...newMatches ]).length, 'others', others.length, 'possibilities', possibilities.length)

    return { matches: [ ...matches, ...newMatches ], others }
  }
}

function finish({ matches }, config) {
  if (config && config.finish === 'shuffle') {
    matches = shuffle(matches)
  }
  return matches.map(taskToString).join('\n')
}

function getEveningTasks(tasks) {
  tasks = chunk(tasks, { strategy: 'next', limit: 7, filter: f.typical })
  tasks = chunk(tasks, { strategy: 'shuffle', limit: 3, filter: f.projects })
  return finish(tasks, { finish: 'shuffle' })
}

function getWeekendTasks(tasks) {
  tasks = chunk(tasks, { strategy: 'next', limit: 7, filter: f.typical })
  tasks = chunk(tasks, { strategy: 'shuffle', limit: 1, filter: f.projects })
  tasks = chunk(tasks, { strategy: 'shuffle', limit: 1, filter: f.shows })
  tasks = chunk(tasks, { strategy: 'shuffle', limit: 1, filter: f.bgames })
  tasks = chunk(tasks, { strategy: 'shuffle', limit: 1, filter: f.vgames })
  tasks = chunk(tasks, { strategy: 'shuffle', limit: 1, filter: f.dates })
  tasks = chunk(tasks, { strategy: 'shuffle', limit: 1, filter: f.movies })
  return finish(tasks, { finish: 'shuffle' })
}

function taskToString(task) {
  let string = `[ ] ${task.description}`
  if(task.annotations && task.annotations.length) string += ` [${task.annotations.length}]`
  return wrap(string, 0, 4)
}

export async function getTaskBlock(event) {
  const tasks = await getTasks()
  let text = ''

  if (event === 'evening') {
    text += '##### Personal\n'
    text += getEveningTasks(tasks)
  } else if (event === 'morning') {
    text += '##### Work\n'
    text += finish(chunk(tasks, { strategy: 'next', limit: 5, filter: f.work }))
    text += '\n\n'
    text += '##### Personal\n'
    text += finish(chunk(tasks, { strategy: 'next', limit: 5, filter: f.typical }))
  } else if (event === 'weekend') {
    text += '##### Personal\n'
    text += getWeekendTasks(tasks)
  } else {
    throw new Error(`Invalid event name (${event})!`)
  }

  return text
}
