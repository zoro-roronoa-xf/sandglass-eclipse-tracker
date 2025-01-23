# Config
`src/index.ts`
```
const RPC_URL = "https://mainnetbeta-rpc.eclipse.xyz";

// Get snapshot
const FILENAME_SNAPSHOT = "output_snapshot.json";

// Get user tokens
const walletAddress = new PublicKey("---user wallet address---");
const FILENAME_USER_TOKENS = "output_user_tokens_" + walletAddress.toString() + ".json";
```

# Usage
```
$ npm install
$ npx ts-node src/index.ts
```
