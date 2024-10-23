#!/bin/bash

#1. Setup:
#   - Sets the Vault address to `http://127.0.0.1:8200`
#   - Retrieves AppRole credentials (ROLE_ID and SECRET_ID) from Vault
#2. `authenticate_vault()` function:
#   - Authenticates with Vault using AppRole credentials
#   - Stores the authentication token in a variable named `DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN`
#3. `store_secrets()` function:
#   - Takes two file paths as arguments
#   - Reads the contents of these files
#   - Stores the contents in Vault under the path `secret/podman-keys` with keys `account_server` and `account_client`
#4. `retrieve_secrets()` function:
#   - Retrieves the secrets stored in `secret/podman-keys`
#   - Outputs each secret individually
#5. `validate_json_file()` function:
#   - Checks if a given file contains valid JSON
#6. Main execution:
#   - Checks if two file paths are provided as arguments
#   - Validates that the files exist and contain valid JSON
#   - Ensures Vault is initialized and unsealed
#   - Authenticates with Vault
#   - Stores the secrets from the provided files
#   - Retrieves and displays the stored secrets

The script is designed to securely handle JSON secrets, storing them in Vault and then retrieving them. It includes error checking at various stages to ensure the process completes successfully.

Would you like me to elaborate on any specific part of the script?

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

# Function to store the secrets
store_secrets() {
    local server_secret=$(cat "$1")
    local client_secret=$(cat "$2")
    echo "Storing secrets..."
    vault kv put secret/podman-keys account_server="$server_secret" account_client="$client_secret"
    if [ $? -eq 0 ]; then
        echo "Secrets stored successfully."
    else
        echo "Failed to store secrets."
        exit 1
    fi
}

# Function to retrieve and echo the secrets individually
retrieve_secrets() {
    echo "Retrieving secrets..."
    
    # Retrieve and echo the first secret
    RETRIEVED_SECRET_1=$(vault kv get -format=json secret/podman-keys | jq -r '.data.data.account_server')
    if [ $? -eq 0 ]; then
        echo "First secret (account_server) retrieved successfully:"
        echo "$RETRIEVED_SECRET_1" | jq .
    else
        echo "Failed to retrieve first secret."
        exit 1
    fi

    echo "------------------------"

    # Retrieve and echo the second secret
    RETRIEVED_SECRET_2=$(vault kv get -format=json secret/podman-keys | jq -r '.data.data.account_client')
    if [ $? -eq 0 ]; then
        echo "Second secret (account_client) retrieved successfully:"
        echo "$RETRIEVED_SECRET_2" | jq .
    else
        echo "Failed to retrieve second secret."
        exit 1
    fi
}

# Function to validate JSON file
validate_json_file() {
    if ! jq . "$1" >/dev/null 2>&1; then
        echo "Error: File '$1' does not contain valid JSON."
        exit 1
    fi
}

# Main execution
echo "Vault JSON Secret Handler"
echo "========================"

# Check if two JSON file paths are provided as arguments
if [ $# -ne 2 ]; then
    echo "Error: Please provide paths to two JSON files as arguments."
    echo "Usage: $0 <path_to_server_json_file> <path_to_client_json_file>"
    exit 1
fi

# Validate that the files exist and contain valid JSON
for file in "$1" "$2"; do
    if [ ! -f "$file" ]; then
        echo "Error: File '$file' does not exist."
        exit 1
    fi
    validate_json_file "$file"
done

# Ensure Vault is initialized and unsealed
vault status > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Error: Vault is not initialized or unsealed. Please check your Vault setup."
    exit 1
fi

# Authenticate with Vault
authenticate_vault

# Store the secrets
store_secrets "$1" "$2"

# Retrieve and echo the secrets individually
retrieve_secrets

echo "========================"
echo "Script completed."
