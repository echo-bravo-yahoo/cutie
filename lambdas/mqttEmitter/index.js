const aws = require('aws-sdk')
const iot = new aws.IotData({endpoint: '<redacted-endpoint>'})

exports.handler = async (event, context, callback) => {
  var params = {
    topic: event.topic,
    payload: JSON.stringify(event),
    qos: 1
  }

  const promise = new Promise((resolve, reject) => {
    iot.publish(params, function(err, data) {
      if (err) {
        reject(err)
      } else {
        resolve(event)
      }
    })
  })

  return promise
}
