export function typical(tasks) {
  return tasks.filter((task) => task && task.project && !task.project.startsWith('work'))
    .filter((task) => !task.tags.includes("bgame") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("vgame") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("show") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("movie") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("outing") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("date") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("read") || task.tags.includes("visible"))
    .filter((task) => !task.tags.includes("unsafe"))
}

export function work(tasks) {
  return tasks.filter((task) => task && task.project && task.project.startsWith('work'))
}

export function projects(tasks) {
  return tasks.filter((task) => task && task.tags && task.tags.includes('project'))
}

export function shows(tasks) {
  return tasks.filter((task) => task && task.tags && task.tags.includes('show'))
}

export function bgames(tasks) {
  return tasks.filter((task) => task && task.tags && task.tags.includes('bgame'))
}

export function vgames(tasks) {
  return tasks.filter((task) => task && task.tags && task.tags.includes('vgame'))
}

export function movies(tasks) {
  return tasks.filter((task) => task && task.tags && task.tags.includes('movie'))
}

export function outings(tasks) {
  return tasks.filter((task) => task && task.tags && task.tags.includes('outing'))
}

export function dates(tasks) {
  return tasks.filter((task) => task && task.tags && task.tags.includes('date'))
}

export function read(tasks) {
  return tasks.filter((task) => task && task.tags && task.tags.includes('read'))
}

export function sex(tasks) {
  return tasks.filter((task) => task && task.tags && task.tags.includes('sex'))
}
