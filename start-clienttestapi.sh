#!/bin/bash
# Script to restart clienttestapi containers in correct order

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if a container is running
check_container_status() {
    local container_name=$1
    local status=$(podman inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null)
    
    if [ "$status" = "running" ]; then
        return 0
    else
        return 1
    fi
}

# Function to get container logs
get_container_logs() {
    local container_name=$1
    echo -e "${YELLOW}Last few lines of logs for $container_name:${NC}"
    podman logs --tail 10 "$container_name"
}

# Function to start a container and verify it's running
start_container() {
    local container_name=$1
    local max_retries=3
    local retry_count=0
    echo -e "${YELLOW}Starting $container_name...${NC}"
    
    while [ $retry_count -lt $max_retries ]; do
        podman start "$container_name" >/dev/null 2>&1
        
        # Wait for container to start (with timeout)
        local wait_count=0
        while [ $wait_count -lt 10 ]; do
            if check_container_status "$container_name"; then
                echo -e "${GREEN}✓ Successfully started $container_name${NC}"
                return 0
            fi
            sleep 1
            ((wait_count++))
        done
        
        # If container failed to start, get logs
        get_container_logs "$container_name"
        
        ((retry_count++))
        if [ $retry_count -lt $max_retries ]; then
            echo -e "${YELLOW}Retrying to start $container_name (attempt $retry_count of $max_retries)${NC}"
        fi
    done
    
    echo -e "${RED}✗ Failed to start $container_name after $max_retries attempts${NC}"
    return 1
}

# Function to stop a container
stop_container() {
    local container_name=$1
    echo -e "${YELLOW}Stopping $container_name...${NC}"
    
    if ! check_container_status "$container_name"; then
        echo -e "${YELLOW}Container $container_name is already stopped${NC}"
        return 0
    fi
    
    podman stop "$container_name" >/dev/null 2>&1
    
    # Check if container stopped successfully
    if ! check_container_status "$container_name"; then
        echo -e "${GREEN}✓ Successfully stopped $container_name${NC}"
        return 0
    else
        echo -e "${RED}✗ Failed to stop $container_name${NC}"
        return 1
    fi
}

# Function to check if container exists
container_exists() {
    local container_name=$1
    podman container exists "$container_name"
    return $?
}

# Function to restart the clienttestapi containers
restart_clienttestapi() {
    echo -e "\n${BLUE}=== Restarting clienttestapi containers on port 3444 ===${NC}"
    
    # Determine which containers exist (promtail may be disabled)
    local existing_containers=()
    for name in "clienttestapi-container" "clienttestapi-nginx" "clienttestapi-promtail"; do
        if container_exists "$name"; then
            existing_containers+=("$name")
        fi
    done
    
    if [ ${#existing_containers[@]} -eq 0 ]; then
        echo -e "${RED}Error: No clienttestapi containers found (expected: clienttestapi-container, clienttestapi-nginx, optional clienttestapi-promtail).${NC}"
        return 1
    fi
    
    # Stop order: promtail -> nginx -> api (only if they exist)
    local stop_containers=()
    container_exists "clienttestapi-promtail" && stop_containers+=("clienttestapi-promtail")
    container_exists "clienttestapi-nginx" && stop_containers+=("clienttestapi-nginx")
    container_exists "clienttestapi-container" && stop_containers+=("clienttestapi-container")
    
    for container in "${stop_containers[@]}"; do
        if ! stop_container "$container"; then
            echo -e "${RED}Warning: Failed to stop $container cleanly.${NC}"
        fi
        sleep 1
    done
    
    # Start order: api -> nginx -> promtail (only if they exist)
    local start_containers=()
    container_exists "clienttestapi-container" && start_containers+=("clienttestapi-container")
    container_exists "clienttestapi-nginx" && start_containers+=("clienttestapi-nginx")
    container_exists "clienttestapi-promtail" && start_containers+=("clienttestapi-promtail")
    
    for container in "${start_containers[@]}"; do
        if ! start_container "$container"; then
            echo -e "${RED}Error: Failed to start $container. Stopping script.${NC}"
            get_container_logs "$container"
            return 1
        fi
        sleep 3
    done
    
    echo -e "${GREEN}All clienttestapi containers restarted successfully!${NC}"
    return 0
}

# Main script
echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}   Restarting ClientTestAPI Service   ${NC}"
echo -e "${BLUE}======================================${NC}"

# Restart clienttestapi containers
if ! restart_clienttestapi; then
    echo -e "${RED}Failed to restart clienttestapi containers. Exiting.${NC}"
    exit 1
fi

# Final status check
echo -e "\n${YELLOW}Checking final status of clienttestapi containers...${NC}"
all_running=true

# Define all containers to check (only include those that exist)
all_containers=()
for name in "clienttestapi-container" "clienttestapi-nginx" "clienttestapi-promtail"; do
    if container_exists "$name"; then
        all_containers+=("$name")
    fi
done

for container in "${all_containers[@]}"; do
    if check_container_status "$container"; then
        echo -e "${GREEN}✓ $container is running${NC}"
    else
        echo -e "${RED}✗ $container is not running${NC}"
        get_container_logs "$container"
        all_running=false
    fi
done

if [ "$all_running" = true ]; then
    echo -e "\n${GREEN}ClientTestAPI service restarted successfully!${NC}"
    echo -e "Client API should now be accessible on port 3444"
else
    echo -e "\n${RED}Some containers failed to start. Please check the logs for more information.${NC}"
    exit 1
fi
