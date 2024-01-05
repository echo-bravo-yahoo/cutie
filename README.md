#### Islands
It's my IOT experiment! Each device is an "island".

##### Things to know:
There's a lot to know about AWS IOT. In general, though, these are the most important:
- You have 2 ways to communicate: shadow updates, and MQTT events. Use shadow updates for state and MQTT events otherwise. Supposedly, with persistent connections, devices will get MQTT events that they missed while offline. I haven't tested this yet, though.
- Having the same device running 2 MQTT clients is bad news. They appear to pick randomly which gets which messages, and both publish.
- I've decided to have homogenous code-bases and store which hardware each device has in its shadow.

##### Known bugs:
- When the Thing receives a desired shadow state, it echoes that back to reported, regardless of whether it can reach that state or not
- When the Thing receives a shadow delta, it echoes only the delta back to reported, causing it to thrash on updates over and over until it receives a full shadow state
