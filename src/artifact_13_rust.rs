> require!(
>     slot >= epoch_start_slot + relay_delay,
>     HeliosError::RelativisticCausalityViolation
> );
>