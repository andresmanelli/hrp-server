# hrp-server
Small server to manage HID-Devices and HRP-compliant robots connections

## Install
```npm install hrp-server```

## Use
Inside a js file: ```var hs = require('hrp-server')(T_CONS,S_CONS,DEBUG)```

Where:
 - T_CONS: if true, an interactive console is shown in the terminal window
 - S_CONS: if true, a remote console via a tcp socket is opened (port 6666)
 - DEBUG: if true, debug messages written with the function _server.debug_ are shown in the console

Refer to the _h_ command in order to get help.

## Notes

 - Joints values are published on a socket on port 5678, for one active connection. No more connections are supported for the moment (at least not for publishing the joint values). 
 - This values can be read by a simulator, allowing remote visualization of the robot state.
 - The socket console is intended to be used with hrp-web-server.

## See also

- [virtual-hrp-robot](https://github.com/andresmanelli/virtual-hrp-robot)
- [hrp-joy-driver](https://github.com/andresmanelli/hrp-joy-driver)
- [hrp](https://github.com/andresmanelli/hrp)
