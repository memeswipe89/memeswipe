import { ethers } from 'ethers';

export async function getBalance(address: string) {
  const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
  const balance = await provider.getBalance(address);
  return Number(ethers.formatEther(balance));
}

