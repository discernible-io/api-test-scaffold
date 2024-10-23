#!/bin/bash

# Vault address
export VAULT_ADDR='http://127.0.0.1:8200'

# AppRole credentials
export ROLE_ID=$(vault read -field=role_id auth/approle/role/podman-role/role-id)
export SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/podman-role/secret-id)

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

# Function to retrieve a specific secret
retrieve_secret() {
    local secret_path=$1
    local field=$2
    echo "Retrieving secret from path: secret/$secret_path"
    if [ -z "$field" ]; then
        RETRIEVED_SECRET=$(vault kv get -format=json "secret/$secret_path" | jq -r '.data.data')
    else
        RETRIEVED_SECRET=$(vault kv get -format=json "secret/$secret_path" | jq -r ".data.data.$field")
    fi
    if [ $? -eq 0 ] && [ "$RETRIEVED_SECRET" != "null" ]; then
        echo "Secret retrieved successfully:"
        echo "$RETRIEVED_SECRET" | jq '.'
    else
        echo "Failed to retrieve secret from path: secret/$secret_path"
    fi
}

# Function to list available secrets
list_secrets() {
    echo "Listing available secrets in the 'secret/' path:"
    vault kv list -format=json secret/ | jq -r '.[]'
}

# Function to list fields in a secret
list_fields() {
    local secret_path=$1
    echo "Listing fields in secret: $secret_path"
    vault kv get -format=json "secret/$secret_path" | jq -r '.data.data | keys[]'
}

# Main execution
echo "Vault Individual Secret Retrieval"
echo "================================="

# Ensure Vault is initialized and unsealed
vault status > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Error: Vault is not initialized or unsealed. Please check your Vault setup."
    exit 1
fi

# Authenticate with Vault
authenticate_vault

# List available secrets
list_secrets

# Prompt user for secret to retrieve
echo -e "\nEnter the name of the secret you want to retrieve (or 'q' to quit):"
read secret_name

while [ "$secret_name" != "q" ]; do
    if [ -n "$secret_name" ]; then
        list_fields "$secret_name"
        echo -e "\nEnter the field name to retrieve (or press Enter for all fields):"
        read field_name
        retrieve_secret "$secret_name" "$field_name"
    else
        echo "Invalid input. Please enter a secret name or 'q' to quit."
    fi
    echo -e "\nEnter another secret name to retrieve (or 'q' to quit):"
    read secret_name
done

echo "================================="
echo "Script completed."