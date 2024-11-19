#!/usr/bin/env node

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import { exec } from 'node:child_process'
/*
{
    "readings": {
        "metadata": {
            "island": "<node>",
            "timestamp": "2024-11-19T04:59:43.405Z"
        },
        "temp": 76.52394317895174,
        "humidity": 28.606149841897132,
        "pressure": 1003.3289466281659
    },
    "dimensions": {
        "island": "<node>",
        "location": "office"
    }
}
*/

export async function handler(event, context, callback) {
  console.log(`event: ${JSON.stringify(event, null, 2)}`)

  await Promise.all([
    logToCloudwatch(event),
    logToInflux(event),
  ])
}

async function logToInflux(event) {
  let data = [],
    labels = []

  for (const [key, value] of Object.entries(event.readings)) {
    if (key !== 'metadata') {
      data.push(`${key}=${value}`)
    }
  }

  for (const [labelKey, labelValue] of Object.entries(event.dimensions)) {
    labels.push(`${labelKey}=${labelValue}`)
  }

  labels = labels.join(',')
  if (labels.length) labels = `,${labels}`
  data = data.join(',')

  let line = `weather${labels} ${data} ${new Date().valueOf()}`
  let url = `http://echobravoyahoo.net:8086/api/v2/write?org=echo-bravo-yahoo&bucket=islands&precision=ms`
  let command = `curl --request POST \
                 --header "Authorization: Token ${process.env.influxdb_token}" \
                 --header "Content-Type: text/plain; charset=utf-8" \
                 --header "Accept: application/json" \
                 --data-binary "${line}" \
                "${url}"`
    console.log(`Running command:\n${command}`)
  return exec(command)
}

async function logToCloudwatch(event) {
  const data = []
  const client = new CloudWatchClient({ region: "us-west-2" })
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
  return client.send(command)
}

// if we aren't in a lambda function (that is, we're running locally):
if (!process.argv[1].includes('/var/runtime')) {
  handler().then(console.log)
}
