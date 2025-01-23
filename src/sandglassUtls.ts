import { BorshAccountsCoder, BN, IdlAccounts } from "@coral-xyz/anchor";
import { PublicKey, Connection, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { AccountLayout, MintLayout, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PythHttpClient, getPythClusterApiUrl, getPythProgramKeyForCluster } from "@pythnetwork/client";
import Decimal from "decimal.js";
import { getTETHPrice, getETHUSDCPrice, getMultipleAccounts, getParsedAmount, getAssociatedTokenAddress } from "./utls";
import { SandglassEclipse, IDL } from "./idl/sandglass_eclipse";

type MarketState = IdlAccounts<SandglassEclipse>["market"];
type SandglassState = IdlAccounts<SandglassEclipse>["sandglassAccount"];
const coder = new BorshAccountsCoder(IDL);

const SANDGLASS_ECLIPSE_PROGRAM_ID = new PublicKey("SANDsy8SBzwUE8Zio2mrYZYqL52Phr2WQb9DDKuXMVK");

export async function getMarketValue(connection: Connection, marketState: MarketState) {
  const pythClient = new PythHttpClient(
    new Connection(getPythClusterApiUrl("pythnet")),
    getPythProgramKeyForCluster("pythnet")
  );

  const { mintDecimals, lpSupplyAmount, ptPoolAmount, ytPoolAmount, epochStartTimestamp, epoch, solanaTimestamp } =
    await getMarketData(connection, marketState);

  const baseTokenPrice = await getBaseTokenPrice(marketState, pythClient);
  const ybtBaseTokenPrice = Number(await getYBTPrice(marketState, pythClient));
  const { marketEndPrice } = getMarketAPY(marketState, ybtBaseTokenPrice, solanaTimestamp, epoch, epochStartTimestamp);
  const ptPrice = getPTPrice(marketState, marketEndPrice);
  const ytPrice = getYTPrice(ptPrice);

  const { poolPtPrice, poolYtPrice } = getPoolPrice(
    marketState,
    ptPoolAmount,
    ytPoolAmount,
    ptPrice,
    ytPrice,
    solanaTimestamp
  );

  const ptTokenPrice = poolPtPrice.mul(baseTokenPrice).mul(ybtBaseTokenPrice);
  const ytTokenPrice = poolYtPrice.mul(baseTokenPrice).mul(ybtBaseTokenPrice);

  const lpPtRate = ptPoolAmount.div(lpSupplyAmount);
  const lpYtRate = ytPoolAmount.div(lpSupplyAmount);

  return { ptTokenPrice, ytTokenPrice, lpPtRate, lpYtRate, mintDecimals };
}

export async function getSandglassAccountInfos(connection: Connection) {
  const sandglassAccountInfos = await connection.getProgramAccounts(SANDGLASS_ECLIPSE_PROGRAM_ID, {
    commitment: "processed",
    filters: [
      {
        dataSize: 416,
      },
    ],
  });

  return sandglassAccountInfos;
}

export function getSandglassStates(accountInfos: any, marketAddress: PublicKey) {
  let sandglassStates: SandglassState[] = [];

  for (const account of accountInfos) {
    const sandglassState: SandglassState = coder.decode("sandglassAccount", account.account.data);

    if (sandglassState.marketAccount.toString() === marketAddress.toString()) {
      sandglassStates = [...sandglassStates, sandglassState];
    }
  }

  return sandglassStates;
}

export async function getTokenAccounts(connection: Connection, mint: PublicKey) {
  const tokenAccounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    commitment: "processed",
    filters: [
      {
        dataSize: 165,
      },
      {
        memcmp: {
          offset: 0,
          bytes: mint.toString(),
        },
      },
    ],
  });

  const tokenAccounts2 = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    commitment: "processed",
    filters: [
      {
        dataSize: 170,
      },
      {
        memcmp: {
          offset: 0,
          bytes: mint.toString(),
        },
      },
    ],
  });

  let tokenAccountStates: any[] = [];

  for (const account of [...tokenAccounts, ...tokenAccounts2]) {
    const parsed = AccountLayout.decode(account.account.data);

    if (parsed.amount > 0) {
      tokenAccountStates = [...tokenAccountStates, parsed];
    }
  }
  return tokenAccountStates;
}

export async function getMarkets(connection: Connection) {
  const accounts = await connection.getProgramAccounts(SANDGLASS_ECLIPSE_PROGRAM_ID, {
    commitment: "processed",
    filters: [
      {
        dataSize: 1104,
      },
    ],
  });

  let markets: { id: PublicKey; data: MarketState }[] = [];

  for (const account of accounts) {
    const pubkey = account.pubkey;
    const data = Buffer.from(account.account.data);
    const market = coder.decode("market", data);

    markets = [...markets, { id: pubkey, data: market }];
  }

  return markets;
}

async function getMarketData(connection: Connection, market: MarketState) {
  let publicKeys: PublicKey[] = [
    market.tokenSyMintAddress,
    market.tokenPtMintAddress,
    market.tokenLpMintAddress,
    market.poolPtTokenAccount,
    market.poolYtTokenAccount,
    SYSVAR_CLOCK_PUBKEY,
  ];

  const accountInfos = await getMultipleAccounts(connection, publicKeys);

  let mintDecimals = new Decimal(0);
  let mintAmount = new Decimal(0);
  let lpSupplyAmount = new Decimal(0);
  let ptPoolAmount = new Decimal(0);
  let ytPoolAmount = new Decimal(0);
  let epochStartTimestamp = 0;
  let epoch = 0;
  let solanaTimestamp = 0;
  for (const accountInfo of accountInfos) {
    if (accountInfo?.publicKey.toString() === market.tokenPtMintAddress.toString()) {
      if (accountInfo) {
        const parsed = MintLayout.decode(accountInfo?.account.data);
        mintDecimals = new Decimal(parsed.decimals);
      }
    } else if (accountInfo?.publicKey.toString() === market.tokenPtMintAddress.toString()) {
      if (accountInfo) {
        const parsed = MintLayout.decode(accountInfo?.account.data);
        mintAmount = new Decimal(getParsedAmount(parsed.supply));
      }
    } else if (accountInfo?.publicKey.toString() === market.tokenLpMintAddress.toString()) {
      if (accountInfo) {
        const parsed = MintLayout.decode(accountInfo?.account.data);
        lpSupplyAmount = new Decimal(getParsedAmount(parsed.supply));
      }
    } else if (accountInfo?.publicKey.toString() === market.poolPtTokenAccount.toString()) {
      if (accountInfo) {
        const parsed = AccountLayout.decode(accountInfo.account.data);
        ptPoolAmount = new Decimal(getParsedAmount(parsed.amount));
      }
    } else if (accountInfo?.publicKey.toString() === market.poolYtTokenAccount.toString()) {
      if (accountInfo) {
        const parsed = AccountLayout.decode(accountInfo.account.data);
        ytPoolAmount = new Decimal(getParsedAmount(parsed.amount));
      }
    } else if (accountInfo?.publicKey.toString() === SYSVAR_CLOCK_PUBKEY.toString()) {
      if (accountInfo) {
        epochStartTimestamp = Number(Buffer.from(accountInfo.account.data.slice(8, 16)).readBigInt64LE());
        epoch = Number(Buffer.from(accountInfo.account.data.slice(16, 24)).readBigUInt64LE());
        solanaTimestamp = Number(Buffer.from(accountInfo.account.data.slice(32, 40)).readBigInt64LE());
      }
    }
  }

  return {
    mintDecimals,
    mintAmount,
    lpSupplyAmount,
    ptPoolAmount,
    ytPoolAmount,
    epochStartTimestamp,
    epoch,
    solanaTimestamp,
  };
}

const getMarketConcentration = (solanaTimestamp: number, marketData: MarketState): Decimal => {
  const initialConcentration = new Decimal(marketData.poolConfig.initialConcentration.toString());
  const maturityConcentration = new Decimal(marketData.poolConfig.maturityConcentration.toString());

  if (maturityConcentration.eq(new Decimal(0))) {
    return initialConcentration;
  }

  if (marketData.marketConfig.endTime.lte(new BN(solanaTimestamp))) {
    return maturityConcentration;
  }

  const timeDiff = new Decimal(solanaTimestamp).sub(new Decimal(marketData.marketConfig.startTime.toString()));
  const totalDiff = new Decimal(marketData.marketConfig.endTime.toString()).sub(
    new Decimal(marketData.marketConfig.startTime.toString())
  );
  const delta = maturityConcentration.sub(initialConcentration).mul(timeDiff).div(totalDiff);
  const concentration = initialConcentration.add(delta);

  return concentration;
};

function getMarketAPY(
  marketData: MarketState,
  solPrice: number,
  nowTime: number,
  epoch: number,
  epochStartTimeStamp: number
) {
  const yearTime = new Decimal(365).times(24).times(60).times(60);
  const solanaTime = new Decimal(nowTime);
  const priceBase = new Decimal(marketData.marketConfig.priceBase.toString());
  const solPriceBI = new Decimal(solPrice).mul(priceBase).floor();

  const epochStartTime = new Decimal(epochStartTimeStamp);
  const updateSkipTime = new Decimal(marketData.marketConfig.updateSkipTime.toString());
  const compoundingPeriod = new Decimal(marketData.marketConfig.compoundingPeriod.toString());

  if (marketData.marketConfig.marketType.eq(new BN("0"))) {
    let marketApy = new Decimal(marketData.marketConfig.marketApy.toString()).div(priceBase);
    let marketSolPrice = new Decimal(marketData.marketConfig.marketSolPrice.toString()).div(priceBase);
    let marketEndPrice = new Decimal(marketData.marketConfig.marketEndPrice.toString()).div(priceBase);

    const nowTime = new Date();
    const endTime = new Date(Number(marketData.marketConfig.endTime) * 1000);

    let marketState = nowTime < endTime;

    if (marketState && marketSolPrice.lt(solPrice)) {
      const startPrice = new Decimal(marketData.marketConfig.startPrice.toString());
      const startTime = new Decimal(marketData.marketConfig.startTime.toString());
      const endTime = new Decimal(marketData.marketConfig.endTime.toString());
      const marketTime = endTime.minus(startTime);

      let epochCount = new Decimal(0);
      let yearEpoch = new Decimal(0);
      let marketEpoch = new Decimal(0);

      if (compoundingPeriod.eq(new Decimal(0))) {
        const lastUpdateEpoch = new Decimal(marketData.marketConfig.lastUpdateEpoch.toString());
        const nowEpoch = new Decimal(epoch);

        if (solanaTime.gt(epochStartTime.plus(updateSkipTime)) && nowEpoch.gte(lastUpdateEpoch)) {
          epochCount = new Decimal(epoch).minus(new Decimal(marketData.marketConfig.startEpoch.toString()));
          const timeDiff = epochStartTime.minus(startTime);
          yearEpoch = yearTime.div(timeDiff).mul(epochCount);
          marketEpoch = epochCount.mul(marketTime).div(timeDiff);
        }
      } else {
        const lastUpdateTime = new Decimal(marketData.marketConfig.lastUpdateTime.toString());
        if (solanaTime.gt(lastUpdateTime.add(updateSkipTime))) {
          const timeDiff = solanaTime.sub(startTime);
          epochCount = timeDiff.div(compoundingPeriod);
          yearEpoch = yearTime.div(compoundingPeriod);
          marketEpoch = marketTime.div(compoundingPeriod);
        }
      }

      if (epochCount.gt(new Decimal(0))) {
        const aprPlusOne = solPriceBI.div(startPrice).pow(new Decimal(1).div(epochCount));
        marketApy = aprPlusOne
          .pow(yearEpoch)
          .minus(1)
          .mul(marketData.marketConfig.priceBase.toString())
          .floor()
          .div(marketData.marketConfig.priceBase.toString());
        marketSolPrice = new Decimal(solPrice);
        marketEndPrice = aprPlusOne
          .pow(marketEpoch)
          .mul(startPrice.div(priceBase))
          .mul(priceBase)
          .floor()
          .div(priceBase);
      }
    }
    return { marketApy, marketEndPrice, marketSolPrice };
  } else {
    const startTime = new Decimal(marketData.marketConfig.startTime.toString());
    const timeDiff = solanaTime.sub(startTime);
    const endTime = new Decimal(marketData.marketConfig.endTime.toString());
    const marketTime = endTime.sub(startTime);
    const initialEndPrice = new Decimal(marketData.marketConfig.initialEndPrice.toString());
    const deltaPrice = initialEndPrice.sub(new Decimal(marketData.marketConfig.startPrice.toString()));

    let marketEndPrice = new Decimal(marketData.marketConfig.startPrice.toString());
    if (timeDiff.lte(marketTime)) {
      marketEndPrice = initialEndPrice
        .sub(deltaPrice.mul(timeDiff).div(marketTime))
        .div(priceBase)
        .mul(priceBase)
        .floor()
        .div(priceBase);
    }
    return { marketApy: new Decimal(0), marketSolPrice: new Decimal(1), marketEndPrice };
  }
}

function getPTPrice(marketData: MarketState, endPrice: Decimal) {
  const priceBase = new Decimal(marketData.marketConfig.priceBase.toString());
  const startPrice = new Decimal(marketData.marketConfig.startPrice.toString()).div(priceBase);
  const ptPrice = startPrice.div(endPrice).times(priceBase).floor().div(priceBase);

  if (ptPrice.greaterThan(1)) {
    return new Decimal(1);
  } else {
    return ptPrice;
  }
}

function getYTPrice(ptPrice: Decimal) {
  return new Decimal(1).minus(ptPrice);
}

function getPoolPrice(
  marketData: MarketState,
  ptAmount: Decimal,
  ytAmount: Decimal,
  ptPrice: Decimal,
  ytPrice: Decimal,
  solanaTimestamp: number
) {
  const concentration = getMarketConcentration(solanaTimestamp, marketData);
  const virtualPt = new Decimal(ptAmount.toString()).plus(concentration);
  const virtualYt = new Decimal(ytAmount.toString()).plus(concentration);

  const poolPrice = virtualYt.div(ytPrice).div(virtualPt.div(ptPrice));

  const poolPtPrice = poolPrice.div(poolPrice.plus(1));
  const poolYtPrice = new Decimal(1).minus(poolPtPrice);

  return { poolPrice, poolPtPrice, poolYtPrice };
}

async function getYBTPrice(marketData: MarketState, pythClient: PythHttpClient): Promise<string> {
  if (marketData.marketConfig.marketType.eq(new BN(0))) {
    if (marketData.tokenSyMintAddress.toString() === "GU7NS9xCwgNPiAdJ69iusFrRfawjDDPjeMBovhV1d4kn") {
      return await getTETHPrice(pythClient);
    } else {
      return "0";
    }
  } else {
    return "1";
  }
}

async function getBaseTokenPrice(marketData: MarketState, pythClient: PythHttpClient): Promise<string> {
  if (marketData.marketConfig.marketType.eq(new BN(0))) {
    if (marketData.tokenSyMintAddress.toString() === "GU7NS9xCwgNPiAdJ69iusFrRfawjDDPjeMBovhV1d4kn") {
      return await getETHUSDCPrice(pythClient);
    } else {
      return "0";
    }
  } else {
    return "1";
  }
}

export async function getSandglassAccount(
  connection: Connection,
  markeAddress: PublicKey,
  walletAddress: PublicKey
): Promise<SandglassState | undefined> {
  const sandglassAddress = findSandglassAddress(markeAddress, walletAddress, SANDGLASS_ECLIPSE_PROGRAM_ID);

  const info = await connection.getAccountInfo(sandglassAddress);

  if (info) {
    const data = Buffer.from(info!.data);
    const coder = new BorshAccountsCoder(IDL);
    const SandglassState: SandglassState = coder.decode("sandglassAccount", data);

    return SandglassState;
  } else {
    return undefined;
  }
}

function findSandglassAddress(marketAddress: PublicKey, walletAddress: PublicKey, programId: PublicKey) {
  const sandglassAddress = PublicKey.findProgramAddressSync(
    [marketAddress.toBuffer(), walletAddress.toBuffer()],
    programId
  );

  return sandglassAddress[0];
}

export async function getUserWalletAmount(connection: Connection, walletAddress: PublicKey, mintAddress: PublicKey) {
  const tokenAccountAddress = getAssociatedTokenAddress(mintAddress, walletAddress);
  const tokenAccountinfo = await connection.getAccountInfo(tokenAccountAddress);
  if (tokenAccountinfo) {
    const parsed = AccountLayout.decode(tokenAccountinfo.data);
    return parsed
  } else {
    return undefined;
  }
}
