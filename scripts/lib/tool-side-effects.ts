/** Reviewed execution effects; MCP destructiveHint is not a transaction classifier. */
const localTools = new Set(["set_active_wallet", "set_wallet_mode", "set_network"]);
const chainTools = new Set([
  "transfer_trx", "transfer_trc20", "supply", "withdraw", "withdraw_all", "borrow", "repay",
  "enter_market", "exit_market", "approve_underlying", "claim_rewards", "approve_jst_for_voting",
  "deposit_jst_for_votes", "withdraw_votes_to_jst", "cast_vote", "withdraw_votes_from_proposal",
  "buy_energy_direct", "rent_energy", "return_energy_rental", "stake_trx_to_strx", "unstake_strx",
  "claim_strx_rewards", "wrap_trx", "unwrap_trx", "approve_moolah_vault", "moolah_vault_deposit",
  "moolah_vault_withdraw", "moolah_vault_redeem", "approve_moolah_proxy", "moolah_supply_collateral",
  "moolah_withdraw_collateral", "moolah_borrow", "moolah_repay", "moolah_liquidate",
  "approve_liquidator_token", "claim_moolah_mining_period", "claim_v1_mining_period",
]);

export function sideEffect(name: string, annotations?: { readOnlyHint?: boolean }): string {
  const knownWrite = localTools.has(name) || chainTools.has(name) || name === "connect_browser_wallet";
  if (annotations?.readOnlyHint === true) {
    if (knownWrite) throw new Error(`Side-effect registry conflicts with readOnlyHint for ${name}`);
    return "🟢 Read-only (Safe / Network Read)";
  }
  if (annotations?.readOnlyHint !== false) throw new Error(`Missing readOnlyHint for ${name}`);
  if (localTools.has(name))
    return "🟡 Local configuration — changes local wallet/network settings; does not build, sign, or broadcast a chain transaction. Confirm the new configuration before subsequent writes.";
  if (name === "connect_browser_wallet")
    return "🟡 Disabled interaction — returns a safety notice; does not build, sign, or broadcast a transaction. Do not bypass the disabled browser bridge.";
  if (name === "buy_energy_direct")
    return "🔴 On-chain transaction — signs a TRX payment locally and submits it to the configured backend, which may broadcast it. Requires explicit confirmation of the exact amount, payee, receivers, duration, and network.";
  if (chainTools.has(name))
    return "🔴 On-chain transaction — may move assets or change allowances, collateral membership, votes, or protocol state. Builds a transaction, requires wallet signing, and may broadcast; explicit human confirmation (HITL) is required before execution.";
  throw new Error(`Unclassified write tool ${name}: review its execution effect before publishing the catalog`);
}
