#!/bin/bash

# Vault address
export VAULT_ADDR='http://127.0.0.1:8200'

# AppRole credentials
ROLE_ID='95df3211-643f-b3a4-ebca-1dc7d16e6655'
SECRET_ID='321962aa-ecc9-5bdf-a5b6-056124e6abd0'

# JSON secret to be stored
JSON_SECRET='{"implicit_account_id":"1ab02c4384b1285d0aa8e4b07ccda3d83e278cd4294a822348a14a512f9884aa","master_seed_phrase":"size surface wagon later sample bird lawsuit walk rubber involve electric depart","private_key":"ed25519:2zscJtZFrYnNotfhMATg3ku9p8bPjAQkeTwHQzhMcqCf2rK229U1g58zZFEFNfkGL7dwrqpbmyZ8LLNRZZrESm61","public_key":"ed25519:2oBQghRxRvLPHfvyHhcaCoczNk9VjXdoxHPPBrXBHcRo","seed_phrase_hd_path":"m/44'"'"'/397'"'"'/0'"'"'"}'

# Function to authenticate with Vault using AppRole
authenticate_vault() {
    echo "Authenticating with Vault..."
    DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN=$(vault write -field=token auth/approle/login \
        role_id="$ROLE_ID" \
        secret_id="$SECRET_ID")
    
    if [ -z "$DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN" ]; then
        echo "Failed to authenticate with Vault."
        exit 1
    fi
    
    export DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN
    echo "Authentication successful."
}

# Function to store the secret
store_secret() {
    echo "Storing secret..."
    vault kv put secret/podman-keys json_data="$JSON_SECRET"
    if [ $? -eq 0 ]; then
        echo "Secret stored successfully."
    else
        echo "Failed to store secret."
        exit 1
    fi
}

# Function to retrieve the secret
retrieve_secret() {
    echo "Retrieving secret..."
    RETRIEVED_SECRET=$(vault kv get -format=json secret/podman-keys | jq -r '.data.data.json_data')
    if [ $? -eq 0 ]; then
        echo "Secret retrieved successfully:"
        echo "$RETRIEVED_SECRET" | jq .
    else
        echo "Failed to retrieve secret."
        exit 1
    fi
}

# Main execution
echo "Vault JSON Secret Handler"
echo "========================"

# Ensure Vault is initialized and unsealed
vault status > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Error: Vault is not initialized or unsealed. Please check your Vault setup."
    exit 1
fi

# Authenticate with Vault
authenticate_vault

# Store the secret
store_secret

# Retrieve the secret
retrieve_secret

echo "========================"
echo "Script completed."
