const fetch = require('node-fetch')

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

function getWorkTasks(tasks, config) {
  console.log('There are', tasks.length, 'tasks.')
  return tasks.filter((task) => task.project.startsWith('work'))
       .sort((a, b) => b.urgency - a.urgency)
       .slice(0, config.limit)
}

function getNextTasks(tasks, config) {
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
       .slice(0, config.limit)
}

function taskToString(task) {
  return `[ ] ${task.description}`
}

// function convertTasksToString(tasks) {
  // return tasks.map(taskToString)
// }

async function getTaskBlock(_config) {
  const tasks = await getTasks()
  const config = _config ? _config : { work: { limit: 5 }, personal: { limit: 5 } }
  let text = ''

  if (config.work.limit) {
    text += '##### Work\n'
    text += (getWorkTasks(tasks, config.work)).map(taskToString).join('\n')
    text += '\n'
  }
  if (config.personal.limit) {
    text += '##### Personal\n'
    text += (getNextTasks(tasks, config.personal)).map(taskToString).join('\n')
    text += '\n'
  }
  return text.trim()
}

exports = module.exports = {
  getTaskBlock
}
