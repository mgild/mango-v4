use anchor_lang::prelude::*;

use crate::accounts_ix::*;
use crate::error::*;
use crate::state::*;

pub fn trigger_check<'key, 'accounts, 'remaining, 'info>(
    ctx: Context<'key, 'accounts, 'remaining, 'info, TriggerCheck<'info>>,
    trigger_id: u64,
) -> Result<()> {
    require!(
        ctx.accounts
            .group
            .load()?
            .is_ix_enabled(IxGate::TriggerCheck),
        MangoError::IxIsDisabled
    );

    // just to ensure the account is good
    ctx.accounts.triggers.load()?;

    let triggers_ai = ctx.accounts.triggers.as_ref();
    let now_slot = Clock::get()?.slot;

    let trigger_offset;
    {
        let bytes = triggers_ai.try_borrow_data()?;
        trigger_offset = Triggers::find_trigger_offset_by_id(&bytes, trigger_id)?;
        let (_triggers, trigger, condition, _action) =
            Trigger::all_from_bytes(&bytes, trigger_offset)?;

        require!(trigger.condition_was_met == 0, MangoError::SomeError);
        require_gt!(trigger.expiry_slot, now_slot);

        condition.check(ctx.remaining_accounts)?;
    }

    let incentive_lamports;
    {
        let mut bytes = triggers_ai.try_borrow_mut_data()?;
        let trigger = Trigger::from_bytes_mut(&mut bytes[trigger_offset..])?;

        trigger.condition_was_met = 1;
        // TODO: how far in the future does a trigger expire once the condition is met?
        trigger.expiry_slot = now_slot + 1000;

        incentive_lamports = trigger.incentive_lamports;
    }

    Triggers::transfer_lamports(triggers_ai, &ctx.accounts.triggerer, incentive_lamports)?;

    Ok(())
}
