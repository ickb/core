use core::result::Result;

use crate::error::Error;

use ckb_std::{ckb_constants::Source, ckb_types::prelude::*, high_level::*};

pub fn extract_ickb_data(index: usize, source: Source) -> Result<(u64, u64, u8), Error> {
    let ickb_data = load_cell_data(index, source)?;

    if ickb_data.len() < 16 {
        return Err(Error::Encoding);
    }

    // Receipt data.
    // The 16th byte stores in a little endian the count of the contiguous deposits.
    let receipt_count = u8::from_le_bytes([ickb_data[15]; 1]);

    // From the 9th byte to the 15th is stored in a little endian the amount of a single deposit.
    let mut buffer = [0u8; 8];
    buffer[0..7].copy_from_slice(&ickb_data[8..15]); // The last byte is already zero.
    let receipt_amount = u64::from_le_bytes(buffer);

    // Token data.
    // From the first byte to the 8th is stored in a little endian the amount of iCKB token.
    buffer.copy_from_slice(&ickb_data[0..8]); // It's safe to reuse the same buffer as all bytes are overwritten.
    let token_amount = u64::from_le_bytes(buffer);

    Ok((token_amount, receipt_amount, receipt_count))
}

pub fn extract_unused_capacity(index: usize, source: Source) -> Result<u64, Error> {
    Ok(load_cell_capacity(index, source)? - load_cell_occupied_capacity(index, source)?)
}

pub fn extract_accumulated_rate(index: usize, source: Source) -> Result<u64, Error> {
    let dao_data = load_header(index, source)?.raw().dao();

    let accumulated_rate = u64_from(dao_data.as_slice(), 8)?;

    Ok(accumulated_rate)
}

pub fn cell_data_has_8_zeroed_bytes(index: usize, source: Source) -> bool {
    let data = match load_cell_data(index, source) {
        Ok(data) => data,
        Err(_) => return false,
    };

    match u64_from(data.as_slice(), 0) {
        Ok(d) => (d == 0),
        Err(_) => false,
    }
}

fn u64_from(data: &[u8], begin: usize) -> Result<u64, Error> {
    let end = begin + 8;

    if data.len() < end {
        return Err(Error::Encoding);
    }

    let mut buffer = [0u8; 8];
    buffer.copy_from_slice(&data[begin..end]);
    let number = u64::from_le_bytes(buffer);

    Ok(number)
}
