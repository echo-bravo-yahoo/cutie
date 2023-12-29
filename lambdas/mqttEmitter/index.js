import { IoTDataPlaneClient, PublishCommand } from "@aws-sdk/client-iot-data-plane"

// const iot = new IoTDataPlaneClient({ endpoint: '<redacted-endpoint>' })
const iot = new IoTDataPlaneClient({ region: 'us-west-2' })

export async function handler(event, context, callback) {
  var params = {
    topic: event.topic,
    payload: JSON.stringify(event),
    qos: 1
  }

  console.log(`Re-broadcasting event ${JSON.stringify(JSON.parse(params.payload), null, 2)} for topic ${params.topic}.`)

  const command = new PublishCommand(params)
  const result = await iot.send(command)
  console.log('Event successfully re-broadcast.')
  return result
}
