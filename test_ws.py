import asyncio
import websockets

async def main():
    # Update the URL to your localtunnel or local IP
    url = 'wss://your-subdomain.loca.lt/ws'
    try:
        async with websockets.connect(url, additional_headers={'Bypass-Tunnel-Reminder': 'true', 'User-Agent': 'localtunnel'}) as ws:
            print('Works!')
            await ws.send('{"type":"HEARTBEAT"}')
            print(await ws.recv())
    except Exception as e:
        print("ERROR:", e)

asyncio.run(main())
