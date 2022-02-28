use std::cell::Ref;

use crate::error::MangoError;
use crate::Mango;
use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use arrayref::array_ref;
use fixed::types::I80F48;

pub enum OracleType {
    Stub,
}

// TODO: what name would be better - stub or mock or integration test oracle?
#[account(zero_copy)]
pub struct StubOracle {
    pub price: I80F48,
    pub last_updated: i64,
}

pub fn determine_oracle_type(account: &AccountInfo) -> Result<OracleType> {
    let data = &account.data.borrow();
    let disc_bytes = array_ref![data, 0, 8];

    if disc_bytes == &StubOracle::discriminator() {
        return Ok(OracleType::Stub);
    }

    Err(MangoError::UnknownOracle.into())
}
