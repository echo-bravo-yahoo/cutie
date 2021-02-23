const secrets = require('./secrets')
const fetch = require('node-fetch')

async function getCategories() {
  const url = `https://api.youneedabudget.com/v1/budgets/${secrets.ynab.budgetId}/categories`
  const res = await fetch(url, {
    headers: {
      Authorization: secrets.ynab.token
    }
  })

  return (await res.json()).data.category_groups.find((group) => group.id === secrets.ynab.groupId).categories
}

function formatMoney(number) {
  return (new Intl.NumberFormat('us-EN', { style: 'currency', currency: 'USD' }).format(number))
}

function getSpent(categories) {
  return categories.reduce((acc, cur) => acc + cur.activity, 0)/1000
}

function getRemaining(categories) {
  return categories.reduce((acc, cur) => acc + cur.balance, 0)/1000
}

function getBudgeted(categories) {
  return getRemaining(categories) - getSpent(categories)
}

function daysInMonth (month, year) {
  return new Date(year, month, 0).getDate();
}

function getPerDay(categories) {
  const remainingDays = daysInMonth(new Date().getMonth(), new Date().getFullYear()) - new Date().getDate()
  return getRemaining(categories) / remainingDays
}

async function getBudgetBlock() {
  const categories = await getCategories()
  let text = ''

  text += '#### Budget\n'
  text += `Remaining: ${formatMoney(getRemaining(categories))} of ${formatMoney(getBudgeted(categories))}\n`
  text += `Per day: ${formatMoney(getPerDay(categories))}\n`

  return text
}

exports = module.exports = {
  getBudgetBlock
}
