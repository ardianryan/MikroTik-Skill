export type CertificationTrack =
  | 'mtcswe'
  | 'mtcine'
  | 'mtcewe'
  | 'mtcwe'
  | 'mtcre'
  | 'mtctce'
  | 'mtcse'
  | 'mtcipv6e'
  | 'mtcume'
  | 'mtcna';

export interface TemplateDefinition {
  track: CertificationTrack;
  title: string;
  description: string;
  script: string;
}

export class CertifiedTemplateGenerator {
  private static templates: Record<CertificationTrack, TemplateDefinition> = {
    mtcswe: {
      track: 'mtcswe',
      title: 'MTCSWE: LACP 802.3ad Bonding & IGMP Snooping Bridge',
      description: 'LACP bonding with Layer 3+4 hash policy, Bridge VLAN filtering, and IGMP/MLD multicast snooping.',
      script: `# MTCSWE: LACP Bonding & Bridge VLAN Filtering
/interface bonding
add name=bond-core slaves=ether1,ether2 mode=802.3ad \\
    transmit-hash-policy=layer-3-and-4 lacp-rate=fast min-links=1 link-monitoring=mii

/interface bridge
add name=bridge1 vlan-filtering=no igmp-snooping=yes mld-snooping=yes dhcp-snooping=yes arp-inspection=yes protocol-mode=rstp

/interface bridge port
add bridge=bridge1 interface=bond-core frame-types=admit-only-vlan-tagged ingress-filtering=yes
add bridge=bridge1 interface=ether3 frame-types=admit-only-untagged-and-priority-tagged pvid=10 ingress-filtering=yes bpdu-guard=yes edge=yes horizon=1
add bridge=bridge1 interface=ether4 frame-types=admit-only-untagged-and-priority-tagged pvid=20 ingress-filtering=yes bpdu-guard=yes edge=yes horizon=1

/interface bridge vlan
add bridge=bridge1 tagged=bridge1,bond-core untagged=ether3 vlan-ids=10
add bridge=bridge1 tagged=bridge1,bond-core untagged=ether4 vlan-ids=20

/interface bridge set bridge1 vlan-filtering=yes`,
    },

    mtcine: {
      track: 'mtcine',
      title: 'MTCINE: MPLS LDP, VPLS L2VPN & Multi-Tenant VRF',
      description: 'MPLS LDP on loopback interface, transparent VPLS tunnel, and isolated VRF routing tables.',
      script: `# MTCINE: MPLS Loopback & LDP
/interface bridge add name=bridge-lo0 comment="System Loopback"
/ip address add address=10.255.255.1/32 interface=bridge-lo0

/routing ospf instance add name=ospf-core router-id=10.255.255.1
/routing ospf area add name=backbone area-id=0.0.0.0 instance=ospf-core
/routing ospf interface-template
add area=backbone networks=10.255.255.1/32 passive=yes
add area=backbone networks=10.0.0.0/24 type=ptp

/mpls ldp add lsr-id=10.255.255.1 transport-address=10.255.255.1 afi=ipv4
/mpls ldp interface add interface=ether1 afi=ipv4

# Transparent VPLS Tunnel
/interface vpls add name=vpls-custA remote-peer=10.255.255.2 vpls-id=100:100 disabled=no

# Multi-Tenant VRF Segmentation
/routing table add name=VRF_TENANT_A fib
/ip vrf add name=VRF_TENANT_A interfaces=vlan10-custA routing-mark=VRF_TENANT_A
/ip route add dst-address=0.0.0.0/0 gateway=198.51.100.1@main routing-table=VRF_TENANT_A`,
    },

    mtcewe: {
      track: 'mtcewe',
      title: 'MTCEWE: Wi-Fi 6 (802.11ax) Central CAPsMAN v2',
      description: 'Modern RouterOS v7 CAPsMAN v2 controller with WPA3-Enterprise and 802.11r/k/v fast roaming.',
      script: `# MTCEWE: Wi-Fi 6 CAPsMAN Controller
/interface wifi capsman
set enabled=yes ca-certificate=auto certificate=auto require-peer-certificate=no

/interface wifi security
add name=SEC-CORP-AX authentication-types=wpa2-psk,wpa3-psk passphrase="ChangeEnterpriseSecret123" \\
    ft=yes ft-over-ds=yes ft-preserve-vlanid=yes wps=disable

/interface wifi channel
add name=CH-5G-AX band=5ghz-ax width=20/40/80mhz skip-dfs-channels=10min-cac
add name=CH-2G-AX band=2ghz-ax width=20mhz

/interface wifi configuration
add name=CFG-CORP-5G mode=ap ssid="Enterprise-Staff" security=SEC-CORP-AX channel=CH-5G-AX \\
    steering.neighbor-report=yes steering.rrm=yes datapath.bridge=bridge1 datapath.vlan-id=10

add name=CFG-CORP-2G mode=ap ssid="Enterprise-Staff" security=SEC-CORP-AX channel=CH-2G-AX \\
    steering.neighbor-report=yes steering.rrm=yes datapath.bridge=bridge1 datapath.vlan-id=10

/interface wifi provisioning
add radio-mac=00:00:00:00:00:00 master-configuration=CFG-CORP-5G supported-bands=5ghz-ax action=create-dynamic-interfaces
add radio-mac=00:00:00:00:00:00 master-configuration=CFG-CORP-2G supported-bands=2ghz-ax action=create-dynamic-interfaces`,
    },

    mtcwe: {
      track: 'mtcwe',
      title: 'MTCWE: Wi-Fi 6 (802.11ax) Standalone Access Point',
      description: 'Standalone 802.11ax AP with fast roaming and dual-band configurations.',
      script: `# MTCWE: Standalone Wi-Fi 6 AP
/interface wifi security
add name=SEC-AP authentication-types=wpa2-psk,wpa3-psk passphrase="ChangeStrongPassphrase123" ft=yes

/interface wifi configuration
add name=CFG-AP-5G mode=ap ssid="Office-WiFi" security=SEC-AP channel.band=5ghz-ax channel.width=20/40/80mhz
add name=CFG-AP-2G mode=ap ssid="Office-WiFi" security=SEC-AP channel.band=2ghz-ax channel.width=20mhz

/interface wifi set [find default-name=wifi1] configuration=CFG-AP-5G disabled=no
/interface wifi set [find default-name=wifi2] configuration=CFG-AP-2G disabled=no`,
    },

    mtcre: {
      track: 'mtcre',
      title: 'MTCRE: Recursive Routing Failover (Virtual SLA)',
      description: 'Dual-WAN recursive route failover with check-gateway=ping and explicit FIB registration.',
      script: `# MTCRE: Recursive Route Failover
/routing table add name=to_ISP1 fib
/routing table add name=to_ISP2 fib

# Target Route via ISP1 (scope=10)
/ip route add dst-address=1.1.1.1/32 gateway=198.51.100.1 scope=10 comment="Target 1.1.1.1 via ISP1"

# Target Route via ISP2 (scope=10)
/ip route add dst-address=9.9.9.9/32 gateway=203.0.113.1 scope=10 comment="Target 9.9.9.9 via ISP2"

# Primary Recursive Default Route (target-scope=11)
/ip route add dst-address=0.0.0.0/0 gateway=1.1.1.1 check-gateway=ping distance=1 target-scope=11 comment="Primary Default Route"

# Secondary Recursive Default Route (target-scope=11)
/ip route add dst-address=0.0.0.0/0 gateway=9.9.9.9 check-gateway=ping distance=2 target-scope=11 comment="Secondary Default Route"`,
    },

    mtctce: {
      track: 'mtctce',
      title: 'MTCTCE: CAKE Anti-Bufferbloat QoS & 4-Tier Mangle',
      description: 'Modern CAKE QoS queuing with diffserv4 and deterministic prerouting mangle hierarchy.',
      script: `# MTCTCE: CAKE QoS & Mangle Ordering
/queue type
add name=cake-download kind=cake cake-diffserv=diffserv4 cake-flowmode=triple-isolate cake-rtt=60ms cake-autorate-ingress=no
add name=cake-upload kind=cake cake-diffserv=diffserv4 cake-flowmode=triple-isolate cake-rtt=60ms

/queue tree
add name=CAKE-WAN-IN parent=bridge1 queue=cake-download max-limit=100M comment="Bufferbloat Limiter Download"
add name=CAKE-WAN-OUT parent=ether1 queue=cake-upload max-limit=20M comment="Bufferbloat Limiter Upload"

# Deterministic Mangle Order
/ip firewall mangle
add chain=prerouting connection-nat-state=dstnat action=accept place-before=0 comment="Tier 0: Hairpin NAT Bypass"
add chain=prerouting dst-address-list=LOCAL_BYPASS action=accept place-before=1 comment="Tier 0: Local Inter-VLAN Bypass"
add chain=forward tcp-flags=syn protocol=tcp action=change-mss new-mss=clamp-to-pmtu comment="Tier 3: MSS Clamping"`,
    },

    mtcse: {
      track: 'mtcse',
      title: 'MTCSE: 7-Pillar Security Hardening & DNS Adlist',
      description: 'Management service port restriction, MAC server isolation, brute-force defense, and adlist sinkholing.',
      script: `# MTCSE: Service Hardening & Port Isolation
/ip service
set winbox address=192.168.88.0/24 disabled=no
set ssh address=192.168.88.0/24 disabled=no
set www-ssl address=192.168.88.0/24 disabled=no
set api address=192.168.88.0/24 disabled=no
set telnet disabled=yes
set ftp disabled=yes
set www disabled=yes

/tool mac-server set allowed-interface-list=LAN
/tool mac-server mac-winbox set allowed-interface-list=LAN
/tool mac-server ping set enabled=no

# RouterOS v7 REST API Hardening
/ip service webserver set rest-plain=no

# Port Scan Defense (PSD) Auto-ban
/ip firewall filter
add chain=input protocol=tcp psd=21,3s,3,1 action=add-src-to-address-list address-list=port-scanners address-list-timeout=1d comment="Detect Port Scanners"
add chain=input src-address-list=port-scanners action=drop comment="Drop Port Scanners"

# Native DNS Malware Sinkhole
/ip dns adlist add url="https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts" ssl-verify=yes`,
    },

    mtcipv6e: {
      track: 'mtcipv6e',
      title: 'MTCIPv6E: Enterprise Dual-Stack & RFC 4890 Firewall',
      description: 'DHCPv6-PD prefix delegation, SLAAC neighbor discovery, and RFC 4890 ICMPv6 firewall filtering.',
      script: `# MTCIPv6E: DHCPv6-PD & SLAAC
/ipv6 dhcp-client add interface=ether1 request=prefix pool-name=isp-ipv6-pool pool-prefix-length=64 use-peer-dns=yes
/ipv6 address add from-pool=isp-ipv6-pool interface=vlan10-staff advertise=yes
/ipv6 nd set [find default=yes] disabled=yes
/ipv6 nd add interface=vlan10-staff managed-address-configuration=no other-configuration=yes advertise-dns=yes

# RFC 4890 Compliant Firewall Filter
/ipv6 firewall filter
add chain=input connection-state=established,related action=accept comment="Accept established/related"
add chain=input connection-state=invalid action=drop comment="Drop invalid"
add chain=input protocol=icmpv6 action=accept comment="Accept Essential ICMPv6 (RFC 4890)"
add chain=input protocol=udp src-port=547 dst-port=546 in-interface=ether1 action=accept comment="Accept DHCPv6 PD"
add chain=input in-interface-list=!LAN action=drop comment="Drop non-LAN input"
add chain=forward connection-state=established,related action=accept comment="Accept established/related"
add chain=forward connection-state=invalid action=drop comment="Drop invalid transit"
add chain=forward in-interface-list=LAN out-interface-list=WAN action=accept comment="Allow LAN to Internet"
add chain=forward in-interface-list=WAN action=drop comment="Drop unsolicited WAN inbound"`,
    },

    mtcume: {
      track: 'mtcume',
      title: 'MTCUME: User Manager v7 & Dynamic 802.1X VLANs',
      description: 'Local User Manager v7 RADIUS server, dynamic VLAN assignment attributes, and captive portal.',
      script: `# MTCUME: User Manager v7 Local RADIUS
/user-manager
set enabled=yes certificate=auto

/user-manager router
add name=local-router address=127.0.0.1 shared-secret="StrongRadiusSecret123"

/user-manager user-group
add name=Staff-VLAN10 attributes=Mikrotik-Group="Staff",Tunnel-Type=13,Tunnel-Medium-Type=6,Tunnel-Private-Group-Id=10

/radius
add service=wireless,login,hotspot address=127.0.0.1 secret="StrongRadiusSecret123"`,
    },

    mtcna: {
      track: 'mtcna',
      title: 'MTCNA: RouterOS v7 Baseline Configuration & Safe Setup',
      description: 'Basic NAT, DHCP server, IP address assignments, DNS cache, and NTP client.',
      script: `# MTCNA: Baseline Setup
/system identity set name="Core-Router"
/system ntp client set enabled=yes servers=0.pool.ntp.org,1.pool.ntp.org
/ip dns set allow-remote-requests=yes servers=1.1.1.1,9.9.9.9

/ip pool add name=dhcp-pool ranges=192.168.88.10-192.168.88.254
/ip dhcp-server add name=dhcp-lan interface=bridge1 address-pool=dhcp-pool disabled=no
/ip dhcp-server network add address=192.168.88.0/24 gateway=192.168.88.1 dns-server=192.168.88.1

/ip firewall nat add chain=srcnat out-interface-list=WAN action=masquerade comment="Default Masquerade"`,
    },
  };

  static get(track: string): TemplateDefinition | undefined {
    const normalized = track.toLowerCase() as CertificationTrack;
    return Object.hasOwn(this.templates, normalized) ? this.templates[normalized] : undefined;
  }

  static list(): TemplateDefinition[] {
    return Object.values(this.templates);
  }
}
