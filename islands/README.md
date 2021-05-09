### Setup & Installation
- Download and install [poetry](https://github.com/python-poetry/poetry#installation), a Python dependency management tool.
- Download and install [node and npm](https://nodejs.org/en/download/)*
- Download your Thing's certificate, public key, and private key to `~/workspace`.
- Download the AmazonRootCA certificate to `~/workspace`.
- Run `poetry install` from `<root>/islands`
- Run `npm install` from `<root>/bitbang`
- Create a file at `<root>/islands/config.json` with the contents:
```json
{
  "id": "the aws iot id; this is also the prefix of your cert/public key/private key file names",
  "name": "the aws iot name; this should be unique"
}
```


* this may be harder on raspi zeroes; should document how to do it for that architecture.

#### Running
`poetry run python3 entry.py`

#### Crontab usage
Add a line to your crontab with `sudo crontab -e`:
```
@reboot cd /home/pi/workspace/islands/islands && sudo -u pi /home/pi/.poetry/bin/poetry run python /home/pi/workspace/islands/islands/entry.py
```

