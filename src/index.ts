import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMarkets,
  getMarketValue,
  getSandglassAccountInfos,
  getSandglassStates,
  getTokenAccounts,
  getSandglassAccount,
  getUserWalletAmount,
} from "./sandglassUtls";
import { getParsedAmount } from "./utls";
import Decimal from "decimal.js";
import fs from "fs";

type ResultSnapshot = {
  marketId: string;
  ptPrice: Decimal;
  ytPrice: Decimal;
  accounts: ResultAccount[];
};

type ResultAccount = {
  walletAddress: string;
  ptAmount: Decimal;
  ytAmount: Decimal;
  lpAmount: Decimal;
  lpPtAmount: Decimal;
  lpYtAmount: Decimal;
};

type ResultUserTokens = {
  marketId: string;
  ptPrice: Decimal;
  ytPrice: Decimal;
  walletAddress: string;
  ptAmount: Decimal;
  ytAmount: Decimal;
  lpAmount: Decimal;
  lpPtAmount: Decimal;
  lpYtAmount: Decimal;
};

async function getSnapshot(connection: Connection) {
  let resultSnapshot: ResultSnapshot[] = [];
  const markets = await getMarkets(connection);
  const sandglassAccountInfos = await getSandglassAccountInfos(connection);

  for (const market of markets) {
    let resultAccount: ResultAccount[] = [];

    const marketId = market.id.toString();
    const { ptTokenPrice, ytTokenPrice, lpPtRate, lpYtRate, mintDecimals } = await getMarketValue(
      connection,
      market.data
    );

    const sandglassStates = getSandglassStates(sandglassAccountInfos, market.id);

    for (const sandglassState of sandglassStates) {
      const owner = sandglassState.userAddress.toString();
      const ptAmount = new Decimal(sandglassState.stakeInfo.stakePtAmount.toString());
      const ytAmount = new Decimal(sandglassState.stakeInfo.stakeYtAmount.toString());
      const lpAmount = new Decimal(sandglassState.stakeInfo.stakeLpAmount.toString());
      const lpPtAmount = lpAmount.mul(lpPtRate).floor();
      const lpYtAmount = lpAmount.mul(lpYtRate).floor();

      if (!(ptAmount.eq(0) && ytAmount.eq(0) && lpAmount.eq(0))) {
        resultAccount = updateResultAccount(
          resultAccount,
          owner,
          ptAmount,
          ytAmount,
          lpAmount,
          lpPtAmount,
          lpYtAmount,
          mintDecimals
        );
      }
    }

    const ptTokenAccounts = await getTokenAccounts(connection, market.data.tokenPtMintAddress);

    for (const tokenAccount of ptTokenAccounts) {
      resultAccount = updateResultAccount(
        resultAccount,
        tokenAccount.owner.toString(),
        new Decimal(getParsedAmount(tokenAccount.amount)),
        new Decimal(0),
        new Decimal(0),
        new Decimal(0),
        new Decimal(0),
        mintDecimals
      );
    }

    const ytTokenAccounts = await getTokenAccounts(connection, market.data.tokenYtMintAddress);

    for (const tokenAccount of ytTokenAccounts) {
      resultAccount = updateResultAccount(
        resultAccount,
        tokenAccount.owner.toString(),
        new Decimal(0),
        new Decimal(getParsedAmount(tokenAccount.amount)),
        new Decimal(0),
        new Decimal(0),
        new Decimal(0),
        mintDecimals
      );
    }

    const lpTokenAccounts = await getTokenAccounts(connection, market.data.tokenLpMintAddress);

    for (const tokenAccount of lpTokenAccounts) {
      resultAccount = updateResultAccount(
        resultAccount,
        tokenAccount.owner.toString(),
        new Decimal(0),
        new Decimal(0),
        new Decimal(getParsedAmount(tokenAccount.amount)),
        new Decimal(getParsedAmount(tokenAccount.amount)).mul(lpPtRate),
        new Decimal(getParsedAmount(tokenAccount.amount)).mul(lpYtRate),
        mintDecimals
      );
    }

    const resultMarket: ResultSnapshot = {
      marketId: marketId,
      ptPrice: ptTokenPrice,
      ytPrice: ytTokenPrice,
      accounts: resultAccount,
    };
    resultSnapshot = [...resultSnapshot, resultMarket];
  }

  return resultSnapshot;
}

export async function getUserTokens(connection: Connection, userWalletAddress: PublicKey) {
  let resultUserTokens: ResultUserTokens[] = [];

  const markets = await getMarkets(connection);

  for (const market of markets) {
    let resultAccount: ResultAccount = {
      walletAddress: userWalletAddress.toString(),
      ptAmount: new Decimal(0),
      ytAmount: new Decimal(0),
      lpAmount: new Decimal(0),
      lpPtAmount: new Decimal(0),
      lpYtAmount: new Decimal(0),
    };

    const marketId = market.id.toString();
    const { ptTokenPrice, ytTokenPrice, lpPtRate, lpYtRate, mintDecimals } = await getMarketValue(
      connection,
      market.data
    );

    const sandglassState = await getSandglassAccount(connection, market.id, userWalletAddress);

    if (sandglassState) {
      const owner = sandglassState.userAddress.toString();
      const ptAmount = new Decimal(sandglassState.stakeInfo.stakePtAmount.toString());
      const ytAmount = new Decimal(sandglassState.stakeInfo.stakeYtAmount.toString());
      const lpAmount = new Decimal(sandglassState.stakeInfo.stakeLpAmount.toString());
      const lpPtAmount = lpAmount.mul(lpPtRate).floor();
      const lpYtAmount = lpAmount.mul(lpYtRate).floor();

      if (!(ptAmount.eq(0) && ytAmount.eq(0) && lpAmount.eq(0))) {
        resultAccount = updateResultUserTokens(
          resultAccount,
          owner,
          ptAmount,
          ytAmount,
          lpAmount,
          lpPtAmount,
          lpYtAmount,
          mintDecimals
        );
      }
    }

    const ptTokenAccounts = await getUserWalletAmount(connection, userWalletAddress, market.data.tokenPtMintAddress);
    if (ptTokenAccounts) {
      resultAccount = updateResultUserTokens(
        resultAccount,
        ptTokenAccounts.owner.toString(),
        new Decimal(getParsedAmount(ptTokenAccounts.amount)),
        new Decimal(0),
        new Decimal(0),
        new Decimal(0),
        new Decimal(0),
        mintDecimals
      );
    }

    const ytTokenAccounts = await getUserWalletAmount(connection, userWalletAddress, market.data.tokenPtMintAddress);
    if (ytTokenAccounts) {
      resultAccount = updateResultUserTokens(
        resultAccount,
        ytTokenAccounts.owner.toString(),
        new Decimal(0),
        new Decimal(getParsedAmount(ytTokenAccounts.amount)),
        new Decimal(0),
        new Decimal(0),
        new Decimal(0),
        mintDecimals
      );
    }

    const lpTokenAccounts = await getUserWalletAmount(connection, userWalletAddress, market.data.tokenPtMintAddress);
    if (lpTokenAccounts) {
      resultAccount = updateResultUserTokens(
        resultAccount,
        lpTokenAccounts.owner.toString(),
        new Decimal(0),
        new Decimal(0),
        new Decimal(getParsedAmount(lpTokenAccounts.amount)),
        new Decimal(getParsedAmount(lpTokenAccounts.amount)).mul(lpPtRate),
        new Decimal(getParsedAmount(lpTokenAccounts.amount)).mul(lpYtRate),
        mintDecimals
      );
    }

    const resultUserTokensMarket = {
      marketId: marketId,
      ptPrice: ptTokenPrice,
      ytPrice: ytTokenPrice,
      walletAddress: resultAccount.walletAddress,
      ptAmount: resultAccount.ptAmount,
      ytAmount: resultAccount.ytAmount,
      lpAmount: resultAccount.lpAmount,
      lpPtAmount: resultAccount.lpPtAmount,
      lpYtAmount: resultAccount.lpYtAmount,
    };
    resultUserTokens = [...resultUserTokens, resultUserTokensMarket];
  }

  return resultUserTokens;
}

function updateResultAccount(
  data: ResultAccount[],
  walletAddress: string,
  ptAmount: Decimal,
  ytAmount: Decimal,
  lpAmount: Decimal,
  lpPtAmount: Decimal,
  lpYtAmount: Decimal,
  decimals: Decimal
) {
  const index = data.findIndex((result) => result.walletAddress === walletAddress);

  if (index === -1) {
    data = [
      {
        walletAddress: walletAddress,
        ptAmount: ptAmount.div(new Decimal(10).pow(decimals)),
        ytAmount: ytAmount.div(new Decimal(10).pow(decimals)),
        lpAmount: lpAmount.div(new Decimal(10).pow(decimals)),
        lpPtAmount: lpPtAmount.div(new Decimal(10).pow(decimals)),
        lpYtAmount: lpYtAmount.div(new Decimal(10).pow(decimals)),
      },
      ...data,
    ];
  } else {
    data[index].ptAmount = data[index].ptAmount.add(ptAmount.div(new Decimal(10).pow(decimals)));
    data[index].ytAmount = data[index].ytAmount.add(ytAmount.div(new Decimal(10).pow(decimals)));
    data[index].lpAmount = data[index].lpAmount.add(lpAmount.div(new Decimal(10).pow(decimals)));
    data[index].lpPtAmount = data[index].lpPtAmount.add(lpPtAmount.div(new Decimal(10).pow(decimals)));
    data[index].lpYtAmount = data[index].lpYtAmount.add(lpYtAmount.div(new Decimal(10).pow(decimals)));
  }

  return data;
}

function updateResultUserTokens(
  data: ResultAccount,
  walletAddress: string,
  ptAmount: Decimal,
  ytAmount: Decimal,
  lpAmount: Decimal,
  lpPtAmount: Decimal,
  lpYtAmount: Decimal,
  decimals: Decimal
) {
  if (data.walletAddress !== walletAddress) return data;

  data.ptAmount = data.ptAmount.add(ptAmount.div(new Decimal(10).pow(decimals)));
  data.ytAmount = data.ytAmount.add(ytAmount.div(new Decimal(10).pow(decimals)));
  data.lpAmount = data.lpAmount.add(lpAmount.div(new Decimal(10).pow(decimals)));
  data.lpPtAmount = data.lpPtAmount.add(lpPtAmount.div(new Decimal(10).pow(decimals)));
  data.lpYtAmount = data.lpYtAmount.add(lpYtAmount.div(new Decimal(10).pow(decimals)));

  return data;
}

async function main() {
  const RPC_URL = "https://mainnetbeta-rpc.eclipse.xyz";
  const connection = new Connection(RPC_URL, "confirmed");

  // Get snapshot
  const FILENAME_SNAPSHOT = "output_snapshot.json";
  const resultSnapshot = await getSnapshot(connection);

  const fileDataSnapshot = JSON.stringify(resultSnapshot, null, 1);
  fs.writeFileSync(FILENAME_SNAPSHOT, fileDataSnapshot);

  // Get user token amount
  const walletAddress = new PublicKey("---user wallet address---");
  const FILENAME_USER_TOKENS = "output_user_tokens_" + walletAddress.toString() + ".json";
  const resultUserTokens = await getUserTokens(connection, walletAddress);

  const fileDataUserTokens = JSON.stringify(resultUserTokens, null, 1);
  fs.writeFileSync(FILENAME_USER_TOKENS, fileDataUserTokens);
}

main();
