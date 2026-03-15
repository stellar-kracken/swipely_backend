import { ethers } from "ethers";
import { config } from "../config/index.js";
import { logger } from "./logger.js";

/**
 * Get an Ethereum JSON-RPC provider.
 * Used for verifying bridge contract state on Ethereum (e.g., USDC supply).
 */
export function getEthereumProvider(): ethers.JsonRpcProvider | null {
  if (!config.ETHEREUM_RPC_URL) {
    logger.warn("No ETHEREUM_RPC_URL configured; Ethereum queries disabled");
    return null;
  }
  return new ethers.JsonRpcProvider(config.ETHEREUM_RPC_URL);
}

// Standard ERC-20 ABI subset for supply queries
const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

/**
 * Get the total supply of an ERC-20 token on Ethereum
 */
export async function getEthereumTokenSupply(
  tokenAddress: string
): Promise<number> {
  const provider = getEthereumProvider();
  if (!provider) {
    throw new Error("Ethereum provider not configured");
  }

  try {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [totalSupply, decimals] = await Promise.all([
      contract.totalSupply(),
      contract.decimals(),
    ]);

    return parseFloat(ethers.formatUnits(totalSupply, decimals));
  } catch (error) {
    logger.error(
      { error, tokenAddress },
      "Failed to fetch Ethereum token supply"
    );
    throw error;
  }
}

/**
 * Get the balance of an ERC-20 token held by a specific address
 * (e.g., a bridge custody / escrow contract)
 */
export async function getEthereumTokenBalance(
  tokenAddress: string,
  holderAddress: string
): Promise<number> {
  const provider = getEthereumProvider();
  if (!provider) {
    throw new Error("Ethereum provider not configured");
  }

  try {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(holderAddress),
      contract.decimals(),
    ]);

    return parseFloat(ethers.formatUnits(balance, decimals));
  } catch (error) {
    logger.error(
      { error, tokenAddress, holderAddress },
      "Failed to fetch Ethereum token balance"
    );
    throw error;
  }
}
