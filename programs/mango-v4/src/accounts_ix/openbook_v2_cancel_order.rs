use anchor_lang::prelude::*;

use crate::error::*;
use crate::state::*;
use openbook_v2::{
    program::OpenbookV2,
    state::{Market, OpenOrdersAccount},
};

#[derive(Accounts)]
pub struct OpenbookV2CancelOrder<'info> {
    #[account(
        constraint = group.load()?.is_ix_enabled(IxGate::OpenbookV2CancelOrder) @ MangoError::IxIsDisabled,
    )]
    pub group: AccountLoader<'info, Group>,

    #[account(
        mut,
        has_one = group,
        constraint = account.load()?.is_operational() @ MangoError::AccountIsFrozen
        // owner is checked at #1
    )]
    pub account: AccountLoader<'info, MangoAccountFixed>,

    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = open_orders.load()?.market == openbook_v2_market_external.key()
    )]
    pub open_orders: AccountLoader<'info, OpenOrdersAccount>,

    #[account(
        has_one = group,
        has_one = openbook_v2_program,
        has_one = openbook_v2_market_external,
    )]
    pub openbook_v2_market: AccountLoader<'info, OpenbookV2Market>,

    pub openbook_v2_program: Program<'info, OpenbookV2>,

    #[account(
        has_one = bids,
        has_one = asks,
    )]
    pub openbook_v2_market_external: AccountLoader<'info, Market>,

    #[account(mut)]
    /// CHECK: bids will be checked by openbook_v2
    pub bids: AccountLoader<'info, ObV2BookSize>,

    #[account(mut)]
    /// CHECK: asks will be checked by openbook_v2
    pub asks: AccountLoader<'info, ObV2BookSize>,
}
