use anchor_lang::prelude::*;

use openbook_v2::cpi::accounts::CancelOrder;

use crate::error::*;
use crate::state::*;

use crate::accounts_ix::*;

use openbook_v2::state::Side as OpenbookV2Side;

pub fn openbook_v2_cancel_order(
    ctx: Context<OpenbookV2CancelOrder>,
    side: OpenbookV2Side,
    order_id: u128,
) -> Result<()> {
    let openbook_market = ctx.accounts.openbook_v2_market.load()?;

    //
    // Validation
    //
    {
        let account = ctx.accounts.account.load_full()?;
        // account constraint #1
        require!(
            account
                .fixed
                .is_owner_or_delegate(ctx.accounts.authority.key()),
            MangoError::SomeError
        );

        // Validate open_orders #2
        require!(
            account
                .openbook_v2_orders(openbook_market.market_index)?
                .open_orders
                == ctx.accounts.open_orders.key(),
            MangoError::SomeError
        );
    }

    //
    // Cancel cpi
    //
    let account = ctx.accounts.account.load()?;
    let account_seeds = mango_account_seeds!(account);
    cpi_cancel_order(ctx.accounts, &[account_seeds], order_id)?;

    // let oo_ai = &ctx.accounts.open_orders.as_ref();
    // let open_orders = load_open_orders_ref(oo_ai)?;
    // let after_oo = OpenOrdersSlim::from_oo(&open_orders);

    // emit!(OpenbookV2OpenOrdersBalanceLog {
    //     mango_group: ctx.accounts.group.key(),
    //     mango_account: ctx.accounts.account.key(),
    //     market_index: serum_market.market_index,
    //     base_token_index: serum_market.base_token_index,
    //     quote_token_index: serum_market.quote_token_index,
    //     base_total: after_oo.native_base_total(),
    //     base_free: after_oo.native_base_free(),
    //     quote_total: after_oo.native_quote_total(),
    //     quote_free: after_oo.native_quote_free(),
    //     referrer_rebates_accrued: after_oo.native_rebates(),
    // });

    Ok(())
}

fn cpi_cancel_order(ctx: &OpenbookV2CancelOrder, seeds: &[&[&[u8]]], order_id: u128) -> Result<()> {
    let cpi_accounts = CancelOrder {
        signer: ctx.account.to_account_info(),
        open_orders_account: ctx.open_orders.to_account_info(),
        market: ctx.openbook_v2_market_external.to_account_info(),
        bids: ctx.bids.to_account_info(),
        asks: ctx.asks.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.openbook_v2_program.to_account_info(),
        cpi_accounts,
        seeds,
    );

    openbook_v2::cpi::cancel_order(cpi_ctx, order_id)
}
