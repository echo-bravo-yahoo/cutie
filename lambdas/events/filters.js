function typical(tasks) {
  return tasks.filter((task) => !task.project.startsWith('work'))
    .filter((task) => !task.tags.includes("bgame") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("vgame") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("show") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("movie") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("outing") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("date") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("read") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("unsafe"))
}

function work(tasks) {
  return tasks.filter((task) => task.project.startsWith('work'))
}

function projects(tasks) {
  return tasks.filter((task) => task.tags.includes('project'))
}

function shows(tasks) {
  return tasks.filter((task) => task.tags.includes('show'))
}

function bgames(tasks) {
  return tasks.filter((task) => task.tags.includes('bgame'))
}

function vgames(tasks) {
  return tasks.filter((task) => task.tags.includes('vgame'))
}

function movies(tasks) {
  return tasks.filter((task) => task.tags.includes('movie'))
}

function outings(tasks) {
  return tasks.filter((task) => task.tags.includes('outing'))
}

function dates(tasks) {
  return tasks.filter((task) => task.tags.includes('date'))
}

function read(tasks) {
  return tasks.filter((task) => task.tags.includes('read'))
}

function sex(tasks) {
  return tasks.filter((task) => task.tags.includes('sex'))
}

exports = module.exports = {
  typical,
  work,
  projects,
  shows,
  bgames,
  vgames,
  movies,
  outings,
  dates,
  read,
  sex
}
