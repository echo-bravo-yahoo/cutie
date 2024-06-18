## To make the server accessible on port 80 without a reverse proxy
https://superuser.com/a/1831458
sysctl -w net.ipv4.conf.all.route_localnet=1
iptables -t nat -I PREROUTING -p tcp --dport 80 -j DNAT --to 127.0.0.1:8080
iptables -t nat -I OUTPUT --src 0/0 --dst 127.0.0.1 -p tcp --dport 80  -j REDIRECT --to-ports 8080
