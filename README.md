![cableguard logo banner](./banner.png)

## Cableguard API for creating RODit
Cableguard API creates sets of RODiT in testnet with all the configuration and subscription information necessary to set up API connections.

Authentication between VPN clients and server uses PKC with a twist. Ownership of the RODiTs doubled-checked with the NEAR Protocol in real time, and the PKC pair used is the pair of the RODiT themselves
Read more here https://vaceituno.medium.com/unleashing-the-power-of-public-key-cryptography-with-non-fungible-tokens-513286d47524

## 0. Pre requisites
- near cli installed
- Download the code from the repository
- When downloading from VS Code it is possible that the shell script files have the wrong permissions and need to be set x so they can run
- Installing npm
- node -v
- sudo npm cache clean -f
- sudo npm install -g n
- sudo n stable
- node -v

## 1. Install and Build
- npm install (in each directory)
- npm run build

## 2. Deploy the Contract
- Delete the neardev directory where the contract is,
- npm run deploy

## 3. Initialize the Contract
- npm run init

## 4. Start the Front End
- npm run start
- open the Front End from a browser
- log in with your NEAR Wallet

4b Start the Front End as a background process
setsid npm run start >/dev/null 2>&1 < /dev/null &

## 5. Jump start your server account
In your VPN Server and VPN Clients, install near and create an implicit account ID and a key pair with the command:
near generate-key

Output example:
- Key pair with ed25519:BNcExLS7k84HswwFHpB49jZnh1y6bsRS7P51FVmeBBxs public key for an ACCOUNT "9a1de9b4aa4ddd4a3091f43f1de680a9f5405d70e8ca69c3fb5daa96b5cd1270"
- Resulting in the key pair stored in: ~/.near-credentials/testnet/9a1de9b4aa4ddd4a3091f43f1de680a9f5405d70e8ca69c3fb5daa96b5cd1270.json
- From your NEAR wallet send some 0.01 Near to the newly generated implicit account ID to activate it

## 6. Input the Cableguard configuration in the Front End
Input values for:
- Number of clients: No default value
- VPN Provider: No default value / IT CAN BE EMPTY
- VPN Service Description: No default value / IT CAN BE EMPTY
- Date of Expiration of VPN Service: 1 year in the future from today / IT CAN BE EMPTY
- Date of Start of VPN Service: today
- IPv4 addresses range of the VPN clients: 10.0.0.1/24
- Port where the VPN server listens: A random number between 49152 and 65535
- DNS server IPv4 address: : No default value / IT CAN BE EMPTY
- Initial IPv4 address for VPN clients: 0.0.0.0/0, ::/0
- IPv4 address of the VPN server where the clients connect: No default value
- Maximum KB per second of each VPN connection: 100000
- Private key in Base58 of the server for signatures: No default value
- Implicit account of the service provider in HEX: No default value

# Cableguard Ecosystem
    Cableguard RODITVPN: RODiT and VPN manager
    Cableguard TOOLS: local VPN tunnel configuration
    Cableguard TUN: VPN tunnels
    Cableguard API: RODiT