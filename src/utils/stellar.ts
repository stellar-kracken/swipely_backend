import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config/index.js";
import { logger } from "./logger.js";

const horizonUrl = config.STELLAR_HORIZON_URL;

/**
 * Get a configured Horizon server instance
 */
export function getHorizonServer(): StellarSdk.Horizon.Server {
  return new StellarSdk.Horizon.Server(horizonUrl);
}

/**
 * Fetch the total supply of an asset on Stellar
 */
export async function getStellarAssetSupply(
  assetCode: string,
  issuer: string
): Promise<number> {
  const server = getHorizonServer();

  try {
    const asset = new StellarSdk.Asset(assetCode, issuer);
    const accounts = await server.assets().forCode(assetCode).forIssuer(issuer).call();

    if (accounts.records.length > 0) {
      return parseFloat(accounts.records[0].amount);
    }
    return 0;
  } catch (error) {
    logger.error({ error, assetCode, issuer }, "Failed to fetch Stellar asset supply");
    throw error;
  }
}

/**
 * Fetch SDEX order book for an asset pair
 */
export async function getOrderBook(
  baseCode: string,
  baseIssuer: string,
  counterCode: string,
  counterIssuer: string | null
): Promise<StellarSdk.Horizon.ServerApi.OrderbookRecord> {
  const server = getHorizonServer();

  const base = new StellarSdk.Asset(baseCode, baseIssuer);
  const counter = counterIssuer
    ? new StellarSdk.Asset(counterCode, counterIssuer)
    : StellarSdk.Asset.native();

  return server.orderbook(base, counter).call();
}

/**
 * Stream ledger effects for real-time monitoring
 */
export function streamPayments(
  onPayment: (payment: StellarSdk.Horizon.ServerApi.PaymentOperationRecord) => void
): () => void {
  const server = getHorizonServer();

  const closeStream = server
    .payments()
    .cursor("now")
    .stream({
      onmessage: (payment) => {
        onPayment(payment as StellarSdk.Horizon.ServerApi.PaymentOperationRecord);
      },
    });

  return closeStream;
}
