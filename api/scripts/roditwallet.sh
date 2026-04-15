#!/bin/bash

#SPDX-License-Identifier: GPL-2.0
#Copyright (C) 2023 Vicente Aceituno Canal vpn@cableguard.org All Rights Reserved.

VERSION="0.94.0"

# Configuration
MAX_RETRIES=3
RETRY_DELAY=2
ACCOUNTS_JSON="$HOME/.near-credentials/accounts.json"

# Network Configuration
# Override the network config by setting NEAR_NETWORK_CONFIG environment variable
# Available configs (check with: near config show-connections):
#   - mainnet-lava (Lava Network - recommended for reliability)
#   - mainnet-fastnear (FastNEAR - default)
#   - testnet-lava (Lava Network testnet)
#   - testnet-fastnear (FastNEAR testnet)
# Example: export NEAR_NETWORK_CONFIG="mainnet-lava"

# Use mainnet-fastnear as default if BLOCKCHAIN_ENV is mainnet
NETWORK_CONFIG="$BLOCKCHAIN_ENV"
if [ "$BLOCKCHAIN_ENV" = "mainnet" ]; then
    NETWORK_CONFIG="mainnet-fastnear"
elif [ "$BLOCKCHAIN_ENV" = "testnet" ]; then
    NETWORK_CONFIG="testnet-fastnear"
fi

# Allow override via environment variable
if [ -n "${NEAR_NETWORK_CONFIG:-}" ]; then
    NETWORK_CONFIG="$NEAR_NETWORK_CONFIG"
    echo "Using network config: $NETWORK_CONFIG"
fi

# Function to refresh accounts.json with all available accounts
refresh_accounts_json() {
    local accounts_array="["
    local first=true
    
    # Add mainnet accounts first (prioritize mainnet)
    if [ -d "$HOME/.near-credentials/mainnet" ]; then
        for account_file in "$HOME/.near-credentials/mainnet/"*.json; do
            if [ -f "$account_file" ]; then
                account_id=$(basename "$account_file" .json)
                if [ "$first" = true ]; then
                    first=false
                else
                    accounts_array="$accounts_array,"
                fi
                accounts_array="$accounts_array\n  {\"account_id\":\"$account_id\",\"used_as_signer\":true}"
            fi
        done
    fi
    
    # Add testnet accounts
    if [ -d "$HOME/.near-credentials/testnet" ]; then
        for account_file in "$HOME/.near-credentials/testnet/"*.json; do
            if [ -f "$account_file" ]; then
                account_id=$(basename "$account_file" .json)
                if [ "$first" = true ]; then
                    first=false
                else
                    accounts_array="$accounts_array,"
                fi
                accounts_array="$accounts_array\n  {\"account_id\":\"$account_id\",\"used_as_signer\":true}"
            fi
        done
    fi
    
    accounts_array="$accounts_array\n]"
    
    # Write to accounts.json (use sudo if file is owned by root)
    if [ -f "$ACCOUNTS_JSON" ] && [ ! -w "$ACCOUNTS_JSON" ]; then
        echo -e "$accounts_array" | sudo tee "$ACCOUNTS_JSON" > /dev/null 2>&1
    else
        echo -e "$accounts_array" > "$ACCOUNTS_JSON" 2>/dev/null
    fi
}

# Refresh accounts.json at startup
refresh_accounts_json

echo "Version" $VERSION "running on " $BLOCKCHAIN_ENV "at Smart Contract" $RODITCONTRACTID " Get help with: "$0" help"

# Function to validate account ID format
validate_account_id() {
    local account="$1"
    # Check if it's an implicit account (64 hex chars) or named account
    if [[ "$account" =~ ^[0-9a-f]{64}$ ]]; then
        echo "Implicit account detected (hex format)"
        return 0
    elif [[ "$account" =~ ^[a-z0-9_-]+\.[a-z0-9_-]+$ ]] || [[ "$account" =~ ^[a-z0-9_-]+$ ]]; then
        echo "Named account detected"
        return 0
    else
        echo "ERROR: Invalid account ID format. Must be either:"
        echo "  - 64 character hex string (implicit account)"
        echo "  - Named account (e.g., user.near or subaccount.user.near)"
        return 1
    fi
}

# Function to execute NEAR command with retry logic
execute_with_retry() {
    local cmd="$1"
    local attempt=1
    local result
    local exit_code
    
    while [ $attempt -le $MAX_RETRIES ]; do
        if [ $attempt -gt 1 ]; then
            echo "Retry attempt $attempt of $MAX_RETRIES..."
            sleep $RETRY_DELAY
        fi
        
        result=$(eval "$cmd" 2>&1)
        exit_code=$?
        
        if [ $exit_code -eq 0 ]; then
            echo "$result"
            return 0
        fi
        
        # Check if it's a network error
        if echo "$result" | grep -q "error while sending payload\|error sending request\|Failed to fetch"; then
            echo "Network error detected on attempt $attempt"
            attempt=$((attempt + 1))
        else
            # Non-network error, don't retry
            echo "$result"
            return $exit_code
        fi
    done
    
    echo "ERROR: Command failed after $MAX_RETRIES attempts"
    echo "$result"
    return 1
}

if [ "$1" == "help" ]; then
    echo "Usage: "$0" [account_id] [Options]"
    echo ""
    echo "Options:"
    echo "  "$0" List of available accounts"
    echo "  "$0" <accountID>           : Lists the RODiTT Ids in the account and its balance"
    echo "  "$0" <accountID> keys      : Displays the accountID and the Private Key of the account"
    echo "  "$0" <accountID> <RODiT Id> : Displays the indicated RODiT"
    echo "  "$0" <funding accountId> <unitialized accountId> init    : Initializes account with 0.01 NEAR from funding acount"
    echo "  "$0" <origin accountId>  <destination accountId> <rotid> : Sends RODiT from origin account to destination account"
    echo "  "$0" genaccount            : Creates a new uninitialized accountID"
    echo ""
    echo "Environment Variables:"
    echo "  NEAR_NETWORK_CONFIG        : Override network config (e.g., export NEAR_NETWORK_CONFIG='mainnet-lava')"
    echo ""
    echo "Available Network Configs:"
    echo "  - mainnet-lava (Lava Network - recommended for reliability)"
    echo "  - mainnet-fastnear (FastNEAR - default)"
    echo "  - testnet-lava (Lava Network testnet)"
    echo "  - testnet-fastnear (FastNEAR testnet)"
    echo ""
    echo "To see all available configs: near config show-connections"
    exit 0
fi

if [ "$1" == "genaccount" ]; then
    account=$(near account create-account \
        fund-later \
        use-auto-generation \
        save-to-folder ~/.near-credentials/$BLOCKCHAIN_ENV | grep -oP '(?<=~/.near-credentials/'"$BLOCKCHAIN_ENV"'/)[^/]+(?=.json)')
    echo "Acccount number:"
    ls -t "$HOME/.near-credentials/$BLOCKCHAIN_ENV/" | head -n 1 | xargs -I {} basename {} .json
    echo "The account does not exist in the blockchain as it has no balance. You need to initialize it with at least 0.01 NEAR."
    exit 0
fi

if [ -n "$3" ] && [ "$3" != "init" ]; then
    validate_account_id "$1" || exit 1
    validate_account_id "$2" || exit 1
    echo "Sending RODiT $3 from $1 to $2..."
    near contract call-function as-transaction "$RODITCONTRACTID" rodit_transfer json-args "{\"receiver_id\": \"$2\", \"token_id\": \"$3\"}" prepaid-gas '30 TeraGas' attached-deposit '1 yoctoNEAR' sign-as "$1" network-config "$NETWORK_CONFIG" sign-with-legacy-keychain send
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to send RODiT"
        exit 1
    fi
    exit 0
fi

if [ "$3" = "init" ] && [ -n "$3" ]; then
    validate_account_id "$1" || exit 1
    validate_account_id "$2" || exit 1
    echo "Initializing with 0.01 NEAR "$2""
    near tokens $1 send-near $2 '0.01 NEAR' network-config $NETWORK_CONFIG sign-with-legacy-keychain send
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to initialize account"
        exit 1
    fi
    echo "Account initialized successfully"
    exit 0
fi

if [ -z $1  ]; then
    echo "The following is a list of accounts found in ~/.near-credentials :"
    formatted_output=$(ls -tr "$HOME/.near-credentials/$BLOCKCHAIN_ENV/" | awk -F '.' '{ print $1 }')
    echo "$formatted_output"
fi

if [ -n "$2" ]; then
    if [ "$2" == "keys" ]; then
        key_file="$HOME/.near-credentials/$BLOCKCHAIN_ENV/$1.json"
        if [ ! -f "$key_file" ]; then
            echo "ERROR: Key file not found for account $1"
            exit 1
        fi
        echo "The contents of the key file (PrivateKey in Base58 account ID in Hex) are:"
        cat "$key_file" | jq -r '.private_key' | cut -d':' -f2
        cat "$key_file" | jq -r '.implicit_account_id' | cut -d':' -f2
        exit 0
    else
        validate_account_id "$1" || exit 1
        echo "RODiT Contents"
        cmd="near contract call-function as-read-only \"$RODITCONTRACTID\" rodit_tokens_for_owner text-args \"{\\\"account_id\\\": \\\"$1\\\"}\" network-config \"$NETWORK_CONFIG\" now"
        
        # Get the raw output and extract JSON array
        raw_output=$(execute_with_retry "$cmd")
        
        # Extract just the JSON array from the output (skip NEAR CLI messages)
        json_output=$(echo "$raw_output" | sed -n '/^\[/,/^\]/p')
        
        # Filter for the specific token_id
        output3=$(echo "$json_output" | jq --arg token_id "$2" '.[] | select(.token_id == $token_id) | {token_id, metadata}' 2>/dev/null)
        
        if [ -z "$output3" ]; then
            echo "ERROR: RODiT $2 not found for account $1"
            echo "Available RODiTs for this account:"
            echo "$json_output" | jq -r '.[].token_id' 2>/dev/null
            exit 1
        fi
        echo "$output3"
        exit 0
    fi
fi

if [ -n "$1" ]; then
    validate_account_id "$1" || exit 1
    
    echo "There is a lag while collecting information from the blockchain"
    echo "The following is a list of RODiT belonging to the input account:"
    
    cmd="near contract call-function as-read-only \"$RODITCONTRACTID\" rodit_tokens_for_owner text-args \"{\\\"account_id\\\": \\\"$1\\\"}\" network-config \"$NETWORK_CONFIG\" now"
    output2=$(execute_with_retry "$cmd")
    rodit_fetch_status=$?
    
    if [ $rodit_fetch_status -ne 0 ]; then
        echo "WARNING: Failed to fetch RODiT tokens after $MAX_RETRIES attempts"
        echo "Possible causes:"
        echo "  - Network connectivity issues"
        echo "  - RPC endpoint unavailable (Pagoda free tier may have rate limits)"
        echo "  - Contract method not available"
        echo ""
        echo "Continuing to check account balance..."
    else
        filtered_output2=$(echo "$output2" | grep 'token_id'| awk -F'"' '{print $4}')
        if [ -z "$filtered_output2" ]; then
            echo "No RODiT tokens found for this account"
        else
            echo "$filtered_output2"
        fi
    fi
    
    echo ""
    echo "Checking account balance..."
    cmd2="near account view-account-summary \"$1\" network-config \"$NETWORK_CONFIG\" now"
    near_state=$(execute_with_retry "$cmd2")
    
    if [ $? -ne 0 ]; then
        echo "WARNING: Could not fetch account balance"
        echo "The account may not exist in the blockchain as it has no balance."
        echo "You need to initialize it with at least 0.01 NEAR."
    else
        balance=$(echo "$near_state"|grep "Native account balance")
        if [ -z "$balance" ]; then
            echo "The account does not exist in the blockchain as it has no balance. You need to initialize it with at least 0.01 NEAR."
        else
            echo "Account $1"
            echo "Has a '$balance'"
        fi
    fi
fi
