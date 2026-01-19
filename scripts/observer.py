
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone

# We'll need a way to fetch data. `requests` is standard but `aiohttp` is better for async.
# Assuming standard requests for simplicity in this script unless user has async flow.
import requests

# --------------------------------------------------------------------------------
# CONFIGURATION
# --------------------------------------------------------------------------------

# Using the public Data API endpoint
DATA_API_URL = "https://data-api.polymarket.com"
CLOB_API_URL = "https://clob.polymarket.com"

# Filter for "Bitcoin Up or Down" markets
MARKET_KEYWORD_1 = "Bitcoin"
MARKET_KEYWORD_2 = "Up or Down"
TIMEFRAME_LABEL = "15m"  # Just a label for our logs

# Polling Interval
POLL_INTERVAL = 5  # seconds

# Output file
EVENTS_LOG_FILE = "events.jsonl"

# Logging Setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("PolyBotObserver")

# --------------------------------------------------------------------------------
# HELPERS
# --------------------------------------------------------------------------------

def log_event(event_type, data):
    """
    Writes a structured event to the JSONL file and logs it to console.
    """
    payload = {
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **data
    }
    
    # Write to file
    with open(EVENTS_LOG_FILE, "a") as f:
        f.write(json.dumps(payload) + "\n")
        
    # Log to console (brief)
    logger.info(f"EVENT: {event_type} - {json.dumps(data)}")

def fetch_active_markets():
    """
    Fetches active markets from Polymarket Data API and filters for BTC 15m.
    """
    try:
        # Fetching events that are active and likely contain our target markets
        # We use a broad search or just fetch active events.
        # Efficient query: active=true, limit=100. Filtering client-side is mostly safer for specific titles.
        url = f"{DATA_API_URL}/events?active=true&closed=false&limit=100"
        resp = requests.get(url)
        resp.raise_for_status()
        events = resp.json()
        
        target_markets = []
        
        for event in events:
            title = event.get("title", "")
            # Check title filters
            if MARKET_KEYWORD_1 in title and MARKET_KEYWORD_2 in title:
                # This is a BTC Up/Down event. Now get the specific market(s) inside.
                # Usually these events have 1 market, but sometimes more.
                markets = event.get("markets", [])
                for m in markets:
                    # We assume 15m markets based on the title structure usually containing time range
                    # e.g., "Bitcoin Up or Down - 1:00PM-1:15PM ET"
                    # We'll assume ANY BTC Up/Down found is valid for this 15m logic 
                    # unless strictly required to parse "15m".
                    target_markets.append({
                        "event_title": title,
                        "market": m,
                        "end_date": m.get("endDate") or event.get("endDate")
                    })
                    
        return target_markets

    except Exception as e:
        logger.error(f"Error fetching markets: {e}")
        return []

def get_market_book(token_id):
    """
    Fetches the order book for a specific token.
    """
    try:
        url = f"{CLOB_API_URL}/book?token_id={token_id}"
        resp = requests.get(url)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        # Just return empty if fail (don't crash loop)
        return {"bids": [], "asks": []}

def get_best_price(book, side):
    """
    Parses CLOB book response to get best price.
    Side: 'bids' (buy) or 'asks' (sell)
    Returns: price (float) or None
    """
    orders = book.get(side, [])
    if not orders:
        return None
    
    # Bids: sorted high to low (best is index 0)
    # Asks: sorted low to high (best is index 0)
    # CLOB returns them sorted usually.
    best_order = orders[0]
    return float(best_order.get("price", 0))

# --------------------------------------------------------------------------------
# MAIN LOOP
# --------------------------------------------------------------------------------

def run_observer():
    logger.info("Starting PolyBot Observer...")
    
    # Main Loop
    while True:
        try:
            # 1. Market Selection
            candidates = fetch_active_markets()
            
            # Sort by end time to find the "current" or "next" active one
            # We want the one that is closing soonest but hasn't closed yet.
            now = datetime.now(timezone.utc)
            
            active_market = None
            
            # Filter checks
            valid_candidates = []
            for item in candidates:
                end_str = item["end_date"] # ISO string
                # Parse if needed, but string comparison works for ISO usually.
                # Let's rely on API `active=true` but double check logic.
                valid_candidates.append(item)
            
            # Sort: earliest end date first
            valid_candidates.sort(key=lambda x: x["end_date"])
            
            if valid_candidates:
                # Pick the first one as the "Active" one to analyze
                target = valid_candidates[0]
                m = target["market"]
                
                # Extract details
                condition_id = m.get("conditionId")
                # Parse outcome tokens. usually JSON string or list.
                # "clobTokenIds": "[\"0x...\", \"0x...\"]"
                token_ids_raw = m.get("clobTokenIds")
                if isinstance(token_ids_raw, str):
                    token_ids = json.loads(token_ids_raw)
                else:
                    token_ids = token_ids_raw
                
                yes_token = token_ids[0] if len(token_ids) > 0 else None
                no_token = token_ids[1] if len(token_ids) > 1 else None

                # 1. Log Market Selection (if changed or periodic?)
                # We'll log it every loop for now or check if it changed.
                # For this script simple "Heartbeat" covers it.
                
                # 2. Status Check
                # Simple check: is it effectively active? Yes if in list.
                status = "active" 
                
                # 3. Heartbeat
                log_event("AnalysisHeartbeat", {
                    "market": target["event_title"],
                    "condition_id": condition_id,
                    "window_end": target["end_date"],
                    "status": "analyzing"
                })

                # 4. Snapshot Books
                yes_book = get_market_book(yes_token)
                no_book = get_market_book(no_token)
                
                yes_bid = get_best_price(yes_book, "bids")
                yes_ask = get_best_price(yes_book, "asks")
                no_bid = get_best_price(no_book, "bids")
                no_ask = get_best_price(no_book, "asks")
                
                snapshot_data = {
                    "condition_id": condition_id,
                    "yes": {"bid": yes_bid, "ask": yes_ask},
                    "no": {"bid": no_bid, "ask": no_ask},
                    # Calculate spread if prices exist
                    "spread_yes": round(yes_ask - yes_bid, 4) if (yes_ask and yes_bid) else None,
                    "spread_no": round(no_ask - no_bid, 4) if (no_ask and no_bid) else None
                }
                log_event("MarketSnapshot", snapshot_data)
                
                # 5. Opportunity Evaluation (Placeholder)
                # Logic: Just log that we checked.
                eval_result = "no_opportunity"
                reason = "placeholder_logic"
                
                # Example dummy logic: if spread is super tight?
                if snapshot_data["spread_yes"] and snapshot_data["spread_yes"] < 0.01:
                    eval_result = "potential_opportunity"
                    reason = "tight_spread_detected"
                
                log_event("OpportunityEvaluation", {
                    "condition_id": condition_id,
                    "result": eval_result,
                    "reason": reason
                })
                
            else:
                logger.info("No active Bitcoin 15m markets found.")
            
            # Wait for next tick
            time.sleep(POLL_INTERVAL)

        except KeyboardInterrupt:
            logger.info("Stopping Observer...")
            break
        except Exception as e:
            logger.error(f"Main loop error: {e}")
            time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    run_observer()
