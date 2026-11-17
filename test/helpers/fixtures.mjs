export function createFixtures() {
  return {
    "/rest/system/identity": { name: "mock-router" },
    "/rest/system/resource": [
      {
        "architecture-name": "arm64",
        "board-name": "CCR2004-1G-12S+2XS",
        cpu: "ARM64",
        "cpu-count": "4",
        "cpu-frequency": "1700",
        "cpu-load": "7",
        "free-hdd-space": "300000000",
        "free-memory": "1500000000",
        "total-hdd-space": "4000000000",
        "total-memory": "2000000000",
        uptime: "1w2d3h",
        version: "7.16.2 (stable)"
      }
    ],
    "/rest/interface": [
      {
        name: "ether1",
        type: "ether",
        mtu: "1500",
        running: "true",
        disabled: "false",
        comment: "WAN",
        "mac-address": "AA:BB:CC:00:00:01",
        "rx-byte": "1000",
        "tx-byte": "2000"
      },
      {
        name: "bridge",
        type: "bridge",
        mtu: "1500",
        running: "true",
        disabled: "false",
        comment: "LAN",
        "mac-address": "AA:BB:CC:00:00:02",
        "rx-byte": "5000",
        "tx-byte": "6000"
      },
      {
        name: "ether2",
        type: "ether",
        mtu: "1500",
        running: "false",
        disabled: "true",
        comment: "spare",
        "mac-address": "AA:BB:CC:00:00:03",
        "rx-byte": "0",
        "tx-byte": "0"
      }
    ],
    "/rest/ip/route": [
      {
        "dst-address": "0.0.0.0/0",
        gateway: "192.168.1.1",
        distance: "1",
        static: "true",
        active: "true",
        disabled: "false",
        comment: "default"
      },
      {
        "dst-address": "192.168.88.0/24",
        gateway: "bridge",
        distance: "0",
        connect: "true",
        active: "true",
        disabled: "false",
        comment: "lan"
      },
      {
        "dst-address": "10.10.10.0/24",
        gateway: "192.168.1.254",
        distance: "5",
        static: "true",
        active: "false",
        disabled: "true",
        comment: "backup"
      },
      {
        "dst-address": "10.20.0.0/16",
        gateway: "192.168.1.2",
        dynamic: "true",
        active: "true",
        disabled: "false"
      }
    ],
    "/rest/ip/firewall/filter": [
      {
        ".id": "*1",
        chain: "input",
        action: "accept",
        protocol: "tcp",
        "dst-port": "22",
        comment: "allow ssh",
        disabled: "false",
        password: "hunter2",
        "pre-shared-key": "should-be-redacted"
      },
      {
        ".id": "*2",
        chain: "forward",
        action: "drop",
        protocol: "tcp",
        comment: "drop unmatched",
        disabled: "false"
      },
      {
        ".id": "*3",
        chain: "input",
        action: "accept",
        protocol: "icmp",
        comment: "allow ping",
        disabled: "false"
      }
    ],
    "/rest/ip/firewall/nat": [
      {
        ".id": "*1",
        chain: "srcnat",
        action: "masquerade",
        "out-interface": "ether1",
        comment: "internet",
        disabled: "false"
      }
    ],
    "/rest/ip/firewall/address-list": [
      {
        ".id": "*1",
        list: "blocked",
        address: "203.0.113.10",
        comment: "bad host",
        disabled: "false",
        dynamic: "false"
      }
    ],
    "/rest/ip/dhcp-server/lease": [
      {
        ".id": "*1",
        address: "192.168.88.10",
        "mac-address": "AA:BB:CC:00:00:11",
        "host-name": "laptop",
        status: "bound",
        server: "dhcp1",
        dynamic: "true",
        disabled: "false"
      },
      {
        ".id": "*2",
        address: "192.168.88.11",
        "mac-address": "AA:BB:CC:00:00:12",
        "host-name": "printer",
        status: "waiting",
        server: "dhcp1",
        dynamic: "true",
        disabled: "false"
      }
    ],
    "/rest/ip/dns": {
      servers: "1.1.1.1,8.8.8.8",
      "dynamic-servers": "192.168.1.1",
      "allow-remote-requests": "true",
      "cache-size": "2048",
      "cache-used": "128",
      "cache-max-ttl": "1w"
    },
    "/rest/ip/dns/static": [
      {
        ".id": "*1",
        name: "router.lan",
        address: "192.168.88.1",
        type: "A",
        ttl: "1d",
        comment: "gateway"
      }
    ],
    "/rest/interface/wireless/registration-table": [
      {
        interface: "wlan1",
        "mac-address": "AA:BB:CC:00:00:21",
        ssid: "lab",
        "signal-strength": "-55dBm",
        "rx-rate": "300Mbps",
        "tx-rate": "300Mbps",
        uptime: "1h"
      }
    ],
    "/rest/log": [
      {
        ".id": "*1",
        time: "12:00:00",
        topics: "system,info",
        message: "logged in via winbox"
      },
      {
        ".id": "*2",
        time: "12:00:05",
        topics: "dhcp,info",
        message: "dhcp assigned 192.168.88.10 to AA:BB:CC:00:00:11"
      },
      {
        ".id": "*3",
        time: "12:00:10",
        topics: "system,info",
        message: "password=supersecret"
      }
    ],
    "POST /rest/ping": [
      { seq: "0", host: "1.1.1.1", time: "10ms", size: "56", ttl: "57" },
      { seq: "1", host: "1.1.1.1", time: "11ms", size: "56", ttl: "57" },
      { seq: "2", status: "timeout" },
      { sent: "3", received: "2", "packet-loss": "33%" }
    ]
  };
}
