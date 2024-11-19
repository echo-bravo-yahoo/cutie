#!/usr/bin/env node

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'

export async function handler(event, context, callback) {
  const client = new CloudWatchClient({ region: "us-west-2" })
  console.log(`event: ${JSON.stringify(event, null, 2)}`)

  const data = []
  const dimensions = Object.entries(event.dimensions).map((entry) => {
    return { Name: entry[0], Value: entry[1] }
  })

  for(let i = 0; i < Object.keys(event.readings).length; i++) {
    if (Object.keys(event.readings)[i] !== 'metadata') {
      data.push({
        MetricName: Object.keys(event.readings)[i],
        Dimensions: dimensions,
        Timestamp: new Date(),
        Value: Object.values(event.readings)[i],
        Unit: "None",
        StorageResolution: 60
      })
    }
  }

  const params = {
    Namespace: "islands",
    MetricData: data,
  }


  const command = new PutMetricDataCommand(params)
  const response = await client.send(command)

  return response
}

// if we aren't in a lambda function (that is, we're running locally):
if (!process.argv[1].includes('/var/runtime')) {
  handler().then(console.log)
}
