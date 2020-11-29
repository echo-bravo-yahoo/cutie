#### Islands
It's my IOT experiment! Each device is an "island".

##### Things to know:
There's a lot to know about AWS IOT. In general, though, these are the most important:
- You have 2 ways to communicate: shadow updates, and MQTT events. Use shadow updates for state and MQTT events otherwise. Supposedly, with persistent connections, devices will get MQTT events that they missed while offline. I haven't tested this yet, though.
- Having the same device running 2 MQTT clients is bad news. They appear to pick randomly which gets which messages, and both publish.
- I've decided to have homogenous code-bases and store which hardware each device has in its shadow.

##### To-do:
- Set up a python language server locally
- Add a logging library and improve logging when failures occur (to cloudwatch?)
- Make virtual mode a flag passed on the command line. Right now, it's a hardcoded constant.
- Figure out a better object composition model (important for my sanity).
- Actually use the "enabled" flag per feature (important for heterogenous fleet).
- Measure more often and report aggregates to AWS (important for sleep model).
- Test if undelivered messages will be delivered on re-connect.
- Add a "job" for "update git repo"
