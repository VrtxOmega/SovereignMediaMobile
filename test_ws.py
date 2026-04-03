import asyncio
import websockets

async def main():
    try:
        async with websockets.connect('wss://omega-audio-rlopez.loca.lt/ws', additional_headers={'Bypass-Tunnel-Reminder': 'true', 'User-Agent': 'localtunnel'}) as ws:
            print('Works!')
            await ws.send('{"type":"HEARTBEAT"}')
            print(await ws.recv())
    except Exception as e:
        print("ERROR:", e)

asyncio.run(main())
