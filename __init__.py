try:
    from . import bridge
except ImportError:
    import bridge

started = False


def register(ctx):
    global started
    started = bridge.start()
    return None
