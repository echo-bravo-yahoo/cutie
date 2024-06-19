      function feedback(res) {
        if (res.$metadata.httpStatusCode === 200) {
          document.querySelector('#response').innerText = 'Success'
        } else {
          document.querySelector('#response').innerText
            = `Error:\n${JSON.stringify(res, null, 4)}`
        }
      }

      /*
      async function ac(event) {
        const url = `/thermostat/${event.target.attributes["data-action"].value}`
        const res = await fetch(url).then((res) => res.json())
        feedback(res)
      }
       */

      async function runScript(event) {
        const topic = event.target.parentElement.attributes["data-location"].value + '/run-script'
        const url = `/mqtt/${topic}`
        const payload = {
          script: event.target.attributes["data-script-name"].value,
          args: event.target.parentElement.querySelector('textarea'),
          timestamp: Date.now()
        }

        if (payload.args === null || payload.args === undefined) {
          delete payload.args
        } else {
          payload.args = payload.args.value
        }

        const fetchArgs = {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' }
        }
        console.log(`Sending payload ${JSON.stringify(payload)} to mqtt topic ${topic}.`)
        const res = await fetch(url, fetchArgs).then((res) => res.json())
        feedback(res)
      }

      async function lamp() {
        const url = `/lamp/toggle`
        const res = await fetch(url).then((res) => res.json())
        feedback(res)
      }

      /*
      async function growLights() {
        const url = `/growLights/toggle`
        const res = await fetch(url).then((res) => res.json())
        feedback(res)
      }
       */

      async function print(event) {
        const payload = { payload: event.target.parentElement.querySelector('textarea').value, timestamp: Date.now() }
        const url = '/thermal-printer'
        const fetchArgs = {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' }
        }
        const res = await fetch(url, fetchArgs)
          .then((res) => res.json())
        feedback(res)
      }

