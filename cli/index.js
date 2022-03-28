#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const islands = [
  {
    "name": "skidaway",
    "ip": "129.168.1.127", // is this right?
    "location": "home office",
    "attached": ["thermal-printer"]
  }
]

yargs(hideBin(process.argv))
  .command({
    command: 'info',
    description: 'list all the known islands',
    builder: yargs => {
      return yargs
    },
    handler: args => {
      function formatIsland(island) {
        let ret = ''

        ret += `${island.name} (${island.ip})\n`
        ret += `  ${island.location}\n`
        ret += `  ${island.attached}`

        return ret
      }

      islands.forEach((island) => console.log(formatIsland(island)))
    }
  })
  .help()
  .argv
