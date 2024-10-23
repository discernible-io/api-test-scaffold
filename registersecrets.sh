export VAULT_DEV_ROOT_TOKEN_ID="6Tz6JD71jzPkUIKaW0s8hrEy"
export VAULT_DEV_UNSEAL_KEY="UEYID9zPFoc++rnCfxAjLhnLll/HL8FYKPyr9/7Ocaw="
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN="6Tz6JD71jzPkUIKaW0s8hrEy"
vault policy write podman-policy podman-policy.hcl
vault write auth/approle/role/podman-role \
    token_policies="podman-policy" \
    token_ttl=1h \
    token_max_ttl=4h
export ROLE_ID=$(vault read -field=role_id auth/approle/role/podman-role/role-id)
export SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/podman-role/secret-id)
./vault_secret_handler.sh ./6c8237be59f1f2c690562f9560a185f20626bba0f09f57695489562cf9b7c8f9.json ../signclient-rodit/9cf2d3a9d4caa4f269e9ccdddfdb3026dab1d5a085afee0b57e85622e6c4a500.json
vault kv get secret/podman-keys
