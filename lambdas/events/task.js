const fetch = require('node-fetch')
const moment = require('moment')

async function getTasks() {
  const res = await fetch('https://inthe.am/api/v2/tasks/', {
    headers: {
      Authorization: 'Token CENSOREDCENSOREDCENSORED'
    }
  })
  const safeData = (await res.json()).map((task) => {
    let _tags
    task.tags ? _tags = task.tags : _tags = []
    return { ...task, tags: _tags }
  })
  return safeData
}

function getWorkTasks(tasks) {
  console.log('There are', tasks.length, 'tasks.')
  return tasks.filter((task) => task.project.startsWith('work'))
       .sort((a, b) => b.urgency - a.urgency)
       .slice(0, 5)
}

function getNextTasks(tasks) {
  return tasks.filter((task) => !task.project.startsWith('work'))
       .filter((task) => !task.tags.includes("bgame") || task.tags.includes("visible"))
       .filter((task) => !task.tags.includes("vgame") || task.tags.includes("visible"))
       .filter((task) => !task.tags.includes("show") || task.tags.includes("visible"))
       .filter((task) => !task.tags.includes("movie") || task.tags.includes("visible"))
       .filter((task) => !task.tags.includes("outing") || task.tags.includes("visible"))
       .filter((task) => !task.tags.includes("date") || task.tags.includes("visible"))
       .filter((task) => !task.tags.includes("read") || task.tags.includes("visible"))
       .filter((task) => !task.tags.includes("unsafe"))
       .sort((a, b) => b.urgency - a.urgency)
       .slice(0, 5)
}

function taskToString(task) {
  return `[ ] ${task.description} (${Math.floor(task.urgency)})`
}

function convertTasksToString(tasks) {
  return tasks.map(taskToString)
}

async function getTaskBlock() {
  const tasks = await getTasks()
  let text = ''
  // on week days, publish work info
  if (![0, 6].includes(moment().day())) {
    text += '##### Work\n'
    text += (getWorkTasks(tasks)).map((task) => `- ${taskToString(task)}`).join('\n')
    text += '\n'
  }
  text += '##### Personal\n'
  text += (getNextTasks(tasks)).map((task) => `- ${taskToString(task)}`).join('\n')
  return text
}

exports = module.exports = {
  getTaskBlock
}
