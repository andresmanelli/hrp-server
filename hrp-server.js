/**
 * hrp-server
 *
 * The HRP Server allow the user to bind joysticks and robots, in order to
 * control them. At the same time, it opens a socket that publish the robot's
 * joints' values for representing the movements in a simulator using an
 * adequate script.
 *
 *
 * Author: Andrés Manelli
 * email: andresmanelli@gmail.com
 *
 * Asociación de Mecatrónica de Mendoza
 */

var hrpServer = function(withConsole,withSocketConsole,debugMode){

  // Dependencies
  var HID = require('node-hid');
  var zmq = require('zmq');
  var prompt = require('prompt');
  var colors = require('colors');
  var Promise = require('es6-promise').Promise;
  var HRP = require('hrp');
  var HRPDefs = HRP(0,0,true);

  // Colors config
  colors.setTheme({
    prompt: 'white',
    info: 'green',
    data: 'yellow',
    warn: 'yellow',
    debug: 'blue',
    error: 'red'
  });

  /** @type {Object} Stores the public functionality of the module */
  var server = {};

  /** @type {Bool} True if the server exposes a console */
  server.withConsole = withConsole;
  /** @type {Bool} True if the server opens a socket for remote commands */
  server.withSocketConsole = withSocketConsole;
  /** @type {Bool} True if the server shows debug messages [Use server.debug(...)] */
  server.debugMode = debugMode;

  /** @type {Array} Stores the HID paths of the present HRP compliant robots */
  server.robots = [];
  /** @type {String} Stores the HID paths of the present HRP compliant robots */
  server.strRobots = '/';
  /** @type {Array} DEPRECATED. Stores all present HID devices */
  server.devs = [];
  /** @type {Array} Stores the HID paths of all the NON HRP compliant devices (Supposed to be joysticks) */
  server.joysticks = [];
  /** @type {String} Stores the HID paths and socket ID of all the NON HRP compliant devices (Supposed to be joysticks) */
  server.strJoys = '/';
  /** @type {String} Stores the HID paths of the physical NON HRP compliant devices (Supposed to be joysticks) */
  server.pstrJoys = '';
  /** @type {Array} Stores the WebSocket ID of the present web based joysticks */
  server.vjoysticks = [];
  /** @type {String} Stores the WebSocket ID of the present web based joysticks */
  server.vstrJoys = '';
  /** @type {Array} Stores the active connections between joysticks and robots */
  server.connections = [];
  /** @type {Object} Stores the up-to-date Robot Path to Robot Index relation */
  server.rPathMap = {};
  /** @type {Object} Stores the up-to-date Joystick Path to Joystick Index relation */
  server.jPathMap = {};

  // Prompt config
  prompt.message = colors.cyan("--> ");

  // Used by the wait timeout
  server.resolve = function(){};
  // Used by the wait timeout
  server.resolveData = '';
  // Used by the wait timeout
  server.avoidBlock = null;

  /**
   * Creates a timeout, preventing infinite waits while waiting for something.
   * resolves the Promise that called it, with the data specified in the
   * calling function.
   */
  var wait = function(){
    server.avoidBlock = setTimeout(function(){
      server.resolve(server.resolveData);
    }, 1000);
  };

  /**
   * Private. Shows the description of the server commands
   * @param  {String} cmd Command to show description of.
   */
  var help = function(cmd){
    if(server.withConsole){
      console.log(colors.debug('*\t',cmd,'\t',':','\t'),colors.info(commands[cmd].desc));
    }
  };

  /**
   * Extracts the arguments from the data received by the ZMQ socket. The
   * arguments order is as follow:
   *   1) WebSocket ID
   *   2) Command to hrp-server.js
   *   3-N) Arguments to Command
   * @param  {Object} _args Arguments. See description above.
   * @return {Array}       Arguments as array. First two are parsed to String.
   */
  var extractSArgs = function(_args){

    var sockID = _args[0].toString();
    var req = _args[1].toString();
    var args = [];
    for(var i=2;i<_args.length;i++){
      args.push(_args[i]);
    }

    // args[i] must be parsed later into the expected type before using!!
    return [sockID,req,args];
  };

  var welcome = function(){

    if(server.withConsole){
      console.log(colors.debug('\n*\t'),colors.debug('Welcome to hrp-server.js'));
      console.log(colors.debug('*'));
      console.log(colors.debug('*\t'),colors.debug('Today is:'), colors.info(new Date().toLocaleDateString()));
      console.log(colors.debug('*\t'),colors.debug('The time is:'),colors.info(new Date().toLocaleTimeString()));
      console.log(colors.debug('*\n*\t'),colors.debug('hrp-server started in console mode. Press'),colors.data('h'),colors.debug('for help.'));   
      if(server.debugMode){
        console.log(colors.debug('*\t'),colors.debug('Debugging enabled'));
        console.log(colors.debug('*\t'),colors.debug('To stop seeing these messages run this module without the debug option.'));
      }
    }

    return true;
  };

  /**
   * Opens socket for the remote commands console
   * @return {Bool} Always true. Shows an error if it could not open the socket.
   */
  var initSConsole = function(){

    if(!server.withSocketConsole){
      return false;
    }

    server.sConsole = zmq.socket('pair');

    server.sConsole.bind('tcp://*:6666', function(err) {
      if(err){
        if(server.withConsole){
          console.log(colors.error('Could not initiate socket console.'));
          console.log(colors.error(err));
        }
      }else{
        server.sConsole.on('message', function() {
          args = extractSArgs(arguments);
          sockID = args[0];
          request = args[1];
          args = args[2];
          
          server.debug(['Received message:',sockID,request,args]);

          if(request === 'addVirtualJoy'){

            server.vjoysticks.push(sockID);
            server.vstrJoys = server.vstrJoys.concat(sockID+'/');
            //Update Joysticks
            server.joys(null,false);
            server.sConsole.send([sockID,request,'true']); // SOCKID+CMD+RES --> OK!

          }else if(request === 'delVirtualJoy'){

            var i = server.vjoysticks.indexOf(sockID);
            server.vjoysticks.splice(i-1,1);
            server.vstrJoys = '';
            server.vjoysticks.forEach(function(vjoy){
              server.vstrJoys = server.vstrJoys.concat(vjoy+'/');
            });
            //Update Joysticks
            server.joys(null,false);
            server.sConsole.send([sockID,request,'true']); // SOCKID+CMD+RES --> OK!

          }else if(server.hasOwnProperty(request)){

            server[request](args,false).then(function(res){
              server.debug(res);
              var msg = [sockID,request].concat(res);
              server.debug(['Emitting:',msg]);
              server.sConsole.send(msg); // SOCKID+CMD+RES --> OK!
            },function(err){
              server.sConsole.send([sockID,request,['error']]);
            });
          }
        });
      }
    });

    return true;
  };

  /**
   * Starts the prompt and shows the welcome message
   * @return {Bool} Always true.
   */
  var initConsole = function(){

    if(server.withConsole){
      prompt.start();
      server.loop(null,true);

      return true;
    }else{
      return false;
    }
  };

  /**
   * Gets the name of the joystick driver from the prompt. If called from
   * outside hrp-server.js (i.e, cons === false), resolves false.
   * 
   * @param  {Array} args Arguments: None
   * @param  {cons} cons  True if called within the terminal console.
   * @return {Promise}    Resolves promise with driver name, rejects it if
   *                      error, or resolves false if called from socket console.
   */
  server.getJoystickDriver = function(args,cons){
    
    if(!cons){
      return Promise.resolve(false);
    }

    return new Promise(function(resolve,reject){
      var schema = {
        properties: {
          driver: {
            pattern: /^[-_a-zA-Z0-9]+$/,
            message: 'Driver must contain only letters and/or numbers. Enter to exit input prompt',
            default: 'GeniusDriver',
            required: false
          }
        }
      };
      
      prompt.get(schema, function(err, result){       
        if(err){
          reject(err);
        }else{
          resolve(result.driver);
        }
      });
    });
  };

  /**
   * Gets a device index from the prompt. If called from outside
   * hrp-server.js (i.e, cons === false), resolves false.
   * 
   * @param  {Array} args Arguments: None
   * @param  {cons} cons  True if called within the terminal console.
   * @return {Promise}    Resolves promise with device index, rejects it if
   *                      error, or resolves false if called from socket console.
   */
  server.getDeviceIndex = function(args,cons){
        
    if(!cons){
      return Promise.resolve(false);
    }

    return new Promise(function(resolve,reject){

      var schema = {
        properties: {
          index: {
            pattern: /^[0-9]+$/,
            message: 'Index must be a positive integer. Enter to exit input prompt',
            default: '1',
            required: false
          }
        }
      };
      
      prompt.get(schema, function(err, result){       
        if(err){
          reject(err);
        }else{
          resolve(result.index);
        }
      });
    });
  };

  /**
   * Gets a device path from the prompt. If called from outside
   * hrp-server.js (i.e, cons === false), resolves false.
   * 
   * @param  {Array} args Arguments: None
   * @param  {cons} cons  True if called within the terminal console.
   * @return {Promise}    Resolves promise with device path, rejects it if
   *                      error, or resolves false if called from socket console.
   */
  server.getPath = function(args,cons){
        
    if(!cons){
      return Promise.resolve(false);
    }

    return new Promise(function(resolve,reject){

      var schema = {
        properties: {
          path: {
            pattern: /^[A-Za-z0-9_:-]+$/,
            message: 'Path must contain only letters, numbers, \'-\', \'_\' and \':\'',
            default: 'virtual',
            required: false
          }
        }
      };
      
      prompt.get(schema, function(err, result){ 
        if(err){
          reject(err);
        }else{
          resolve(result.path);
        }
      });
    });
  };

  /**
   * Gets a robot's information.
   * 
   * @param  {Array} args Arguments:
   *                      1) Robot index of server.robots
   * @param  {Bool} cons  True if called within the terminal console.
   * @return {Promise}    If success, resolves [strINFO,robotIndex]
   *                      strINFO: String with robot's information sended by robot
   *                      robotIndex: Robot index (same as argument).
   *                      If error, rejects(err)
   */
  server.info = function(args,cons){

    if(server.robots.length === 0){
      var robotIndex = -1; // Invalid index for rejecting
      if(server.withConsole && cons){
        console.log(colors.error('\n*\t'),colors.error('Error:'));
        console.log(colors.error('*\t\t'),colors.debug('There are no robots currently listed.'));
        console.log(colors.error('*\t\t'),colors.debug('Please run the'),colors.data('robs'),colors.debug('command first.'));
        console.log(colors.error('*\t\t'),colors.debug('Be sure your robot is physically (or virtually) connected.\n'));
      }
      return Promise.reject('There are no robots currently listed');
    }

    if(!args && cons){
      return new Promise(function(resolve, reject){          
        console.log(colors.debug('Robot Index:'));
        server.getDeviceIndex([],cons).then(function(robotIndex){
          server.info([robotIndex],cons).then(function(infInd){
            resolve(infInd);
          }).catch(function(err){
            reject(err);
          });
        }).catch(function(err){
          if(server.withConsole && cons)
            console.log(colors.error(err));
          reject(err);
        });
      });
    }else{
      try{
        var robotIndex = parseInt(args[0]);
      }catch(err){
        server.debug(['info(): ',err]);
        return Promise.reject(err);
      }

      if(robotIndex < 1 || robotIndex > server.robots.length){
        if(server.withConsole && cons){
          console.log(colors.error('Not valid index provided, going back to main menu'));
        }
        return Promise.reject('Not valid index provided, going back to main menu');
      }

      return new Promise(function(resolve,reject){
        var info;
        var r = HRP(server.robots[robotIndex-1],5555);
        if(!r){
          if(server.withConsole && cons){
            console.log(colors.error('An error ocurred with robot '+server.robots[robotIndex-1]));
          }
          reject('An error ocurred with robot '+server.robots[robotIndex-1]);
        }
        r.connect();
        r.getRobotInfo().then(function(info){
          r.disconnect();
          if(server.withConsole && cons){
            console.log(colors.debug('\n*\t'),colors.debug('Info for Robot '),colors.data(robotIndex),colors.debug(':'));
            var jsonInfo = HRPDefs.str2RobotInfo(info);
            console.log(jsonInfo); //TODO!!! Presentation
            console.log(); // '\n'
          }
          resolve([info,robotIndex]);
        }).catch(function(err){
          r.disconnect();
          if(server.withConsole && cons){
            console.log(colors.error('No info for Robot ',robotIndex,'. Consider listing robots again using command \'robs\'.'));
          }
          reject('No info for Robot ',robotIndex);
        });
      });
    }
  };

  /**
   * Gets the connected HRP compliant robots
   * 
   * @param  {Array} args Arguments: None
   * @param  {Bool} cons  True if called within the terminal console.
   * @return {Promise}    If success, resolves [strRobots,server.robots]
   *                         strRobots: String with robots paths
   *                         server.robots: Array containing the detected robots
   *                      If error, rejects(err)
   */
  server.robs = function(args,cons){

    var devices = HID.devices();
    var robots = [];
    var strRobots = '/';
    var is = [];
    
    for (var i=0;i<devices.length;i++){
      var a = HRP(devices[i].path);
      is.push(a.isHRP());
    }

    return new Promise(function(resolve,reject){

      Promise.all(is).then(function(results){
        results.forEach(function(rob,i){            
          if(rob){
            robots.push(devices[i].path);
            strRobots = strRobots.concat(devices[i].path+'/');
          }
        });

        var a = HRP('virtual',5555);
        if(!a){
          if(server.withConsole && cons){
            console.log(colors.warn('An error ocurred with robot: virtual'));
          }
          resolve([strRobots,robots]);
        }
        return a.isHRP(); //Promise!
      }).then(function(rob){
        if(rob){
          robots.push('virtual');
          strRobots = strRobots.concat('virtual/');
        }
        if(server.withConsole && cons){
          console.log(colors.debug('\n*\t'),colors.debug('Please note that a robot is binded, it WILL NOT appear in this list.'));
          console.log(colors.debug('*\t'),colors.debug('(A virtual robot may appear but deppending on the socket state).'));
          console.log(colors.debug('*\t'),colors.debug('After unbinding it, you should re-robs the server.\n*'));

          if (robots.length === 0)
            console.log(colors.debug('*\t'),colors.debug('No robots connected'));
          else
            console.log(colors.debug('*\t'),colors.debug('Robots connected:'),colors.data(robots.length),colors.debug('\n*'));
          robots.forEach(function(robot,i){
            console.log(colors.debug('*\t'),colors.debug('\tRobot '+(i+1)+'\t:\t'),colors.info(robot));
          });
          console.log(''); //'\n'
        }
        server.robots = robots;
        server.updateRPathMap();
        resolve([strRobots,robots]);
      });
    });
  };

  /**
   * Updates the Joystick Path to Joystcik Index relation
   */
  server.updateJPathMap = function(){
    server.joysticks.forEach(function(joy,i){
      server.jPathMap[joy] = i+1;
    });
  };

  /**
   * Updates the Robot Path to Robot Index relation
   */
  server.updateRPathMap = function(){
    server.robots.forEach(function(rob,i){
      server.rPathMap[rob] = i+1;
    });
  };

  /**
   * Gets the connected non HRP compliant devices (Assumed as joysticks)
   * 
   * @param  {Array} args Arguments: None
   * @param  {Bool} cons  True if called within the terminal console.
   * @return {Promise}    If success, resolves [strJoys,server.joysticks]
   *                         strJoys: String with joysticks paths
   *                         server.joysticks: Array containing the detected joysticks
   *                      If error, rejects(err)
   */
  server.joys = function(args,cons){

    var devices = HID.devices();      
    var joys = [];
    server.strJoys = '/';
    server.pstrJoys = '';
    var is = [];

    return new Promise(function(resolve,reject){
      for (var i=0;i<devices.length;i++){
        var a = HRP(devices[i].path);
        is.push(a.isHRP());
      }
    
      Promise.all(is).then(function(results){
        results.forEach(function(is,i){
          if(!is){
            joys.push(devices[i].path);
            server.pstrJoys = server.pstrJoys.concat(devices[i].path+'/');
          }
        });        
        
        var joysticks = joys.concat(server.vjoysticks);
        var strJoys = server.strJoys.concat(server.pstrJoys,server.vstrJoys);

        server.joysticks = joysticks;
        server.strJoys = strJoys;
        
        if(server.withConsole && cons){
          console.log(colors.debug('\n*\t'),colors.debug('Please note that a joystick is binded, it WILL NOT appear in this list.'));
          console.log(colors.debug('*\t'),colors.debug('After unbinding it, you should re-joys the server.\n*'));

          if (joysticks.length === 0)
            console.log(colors.debug('*\t'),colors.debug('No joysticks connected'));
          else
            console.log(colors.debug('*\t'),colors.debug('Joysticks connected:'),colors.data(joysticks.length),colors.debug('\n*'));
          joysticks.forEach(function(joy,i){
            console.log(colors.debug('*\t'),colors.debug('\tJoystick '+(i+1)+'\t:\t'),colors.info(joy));
          });
          console.log(''); //'\n'
        }

        server.updateJPathMap();
        resolve([strJoys, joysticks]);
      });
    });
  };

  /**
   * Binds robot and joystick, and publishes robot's joints values.
   *
   *  ARGUMENTS ARE PATHS
   * 
   * @param  {Array} args Arguments:
   *                      1) robotPath: The path of the robot
   *                      2) joyPath: The path of the joystick
   *                      3) joyDriver: Driver file for the selected joystick
   * @param  {Bool} cons  True if called within the terminal console.
   * @return {Promise}    Resolves: [binded]
   *                        binded: true if binded correctly, false otherwise
   */
  server.pbind = function(args,cons){

    if(!args && cons){

      var robotPath,joyPath;

      return new Promise(function(resolve, reject){

        console.log(colors.debug('*\t'),colors.debug('Robot Path:'));
        server.getPath([],true).then(function(path){
          robotPath = path;
          console.log(colors.debug('*\t'),colors.debug('Joystick Path:'));            
          return server.getPath([],true);
        }).then(function(path){
          joyPath = path;
          console.log(colors.debug('*\t'),colors.debug('Joystick Driver:'));
          return server.getJoystickDriver([],true);
        }).then(function(joyDriver){
          // OK BIND
          return server.pbind([robotPath,joyPath,joyDriver],cons);
        }).then(function(binded){
          // binded is already an array!
          resolve(binded);
        }).catch(function(err){
          console.log(colors.error('*\t'),colors.error('Error:\n*'));
          console.log(colors.error('*\t'),colors.debug(err));
          resolve([false]);
        });
      });
    }else{
      try{
        var robotPath = args[0].toString();
        var joyPath = args[1].toString();
        var joyDriver = args[2].toString();
        console.log(robotPath,joyPath,joyDriver);
      }catch(err){
        server.debug(['pbind(): ',err]);
        return Promise.resolve([false]);
      }
      console.log(server.rPathMap,server.jPathMap);
      return server.bind([server.rPathMap[robotPath],server.jPathMap[joyPath],joyDriver],cons);
    }
  };

  /**
   * Unbinds robot and joystick.
   *
   *  ARGUMENTS ARE PATHS
   * 
   * @param  {Array} args Arguments:
   *                      1) robotPath: The path of the robot
   *                      2) joyPath: The path of the joystick
   * @param  {Bool} cons  True if called within the terminal console.
   * @return {Promise}    Resolves: [unbinded]
   *                        unbinded: true if binded correctly, false otherwise
   */
  server.pubind = function(args,cons){

    if(!args && cons){

      var robotPath,joyPath;

      return new Promise(function(resolve, reject){

        console.log(colors.debug('*\t'),colors.debug('Robot Path:'));
        server.getPath([],true).then(function(path){
          robotPath = path;
          console.log(colors.debug('*\t'),colors.debug('Joystick Path:'));            
          return server.getPath([],true);
        }).then(function(path){
          joyPath = path;
          return server.pubind([robotPath,joyPath],cons);
        }).then(function(unbinded){
          // unbinded is already an array!
          resolve(unbinded);
        }).catch(function(err){
          console.log(colors.error('*\t'),colors.error('Error:\n*'));
          console.log(colors.error('*\t'),colors.debug(err));
          resolve([false]);
        });
      });
    }else{
      try{
        var robotPath = args[0].toString();
        var joyPath = args[1].toString();
      }catch(err){
        server.debug(['pubind(): ',err]);
        return Promise.resolve([false]);
      }

      // Look for the connIndex
      var connIndex = -1;
      server.connections.some(function(conn,i){
        if(conn.robot === robotPath && conn.joy === joyPath){
          connIndex = i+1;
          return true;
        }

        return false;
      });

      return server.ubind([connIndex],cons);
    }
  };

  /**
   * Binds robot and joystick, and publishes robot's joints values.
   *
   * ARGUMENTS ARE INDEXES
   * 
   * @param  {Array} args Arguments:
   *                      1) robotIndex: The index of the robot in server.robots
   *                      2) joyIndex: The index of the joystick in server.joysticks
   *                      3) joyDriver: Driver file for the selected joystick
   * @param  {Bool} cons  True if called within the terminal console.
   * @return {Promise}    Resolves: [binded]
   *                        binded: true if binded correctly, false otherwise
   */
  server.bind = function(args,cons){

    if(!args && cons){

      var robotIndex,joyIndex;

      return new Promise(function(resolve, reject){

        console.log(colors.debug('*\t'),colors.debug('Robot Index:'));
        server.getDeviceIndex([],true).then(function(index){
          robotIndex = index;
          console.log(colors.debug('*\t'),colors.debug('Joystick Index:'));            
          return server.getDeviceIndex([],true);
        }).then(function(index){
          joyIndex = index;
          console.log(colors.debug('*\t'),colors.debug('Joystick Driver:'));
          return server.getJoystickDriver([],true);
        }).then(function(joyDriver){
          // OK BIND
          return server.bind([robotIndex,joyIndex,joyDriver],cons);
        }).then(function(binded){
          // binded is already an array!
          resolve(binded);
        }).catch(function(err){
          console.log(colors.error('*\t'),colors.error('Error:\n*'));
          console.log(colors.error('*\t'),colors.debug(err));
          resolve([false]);
        });
      });
    }else{
      try{
        var robotIndex = parseInt(args[0]);
        var joyIndex = parseInt(args[1]);
        var joyDriver = args[2].toString();
      }catch(err){
        server.debug(['bind(): ',err]);
        return Promise.resolve([false]);
      }

      if(robotIndex < 1 || robotIndex > server.robots.length){
        if(server.withConsole && cons)
          console.log(colors.error('\n*\t'),colors.error('Error:'));
          console.log(colors.error('*\t'),colors.debug('Robot index is not valid.'));
          console.log(colors.error('*\t'),colors.debug('Check robots with the'),colors.data('robs'),colors.debug('command\n'));
        return Promise.resolve([false]);
      }else if(joyIndex < 1 || joyIndex > server.joysticks.length){
        if(server.withConsole && cons)
          console.log(colors.error('\n*\t'),colors.error('Error:'));
          console.log(colors.error('*\t'),colors.debug('Joystick index is not valid.'));
          console.log(colors.error('*\t'),colors.debug('Check joysticks with the'),colors.data('joys'),colors.debug('command\n'));
        return Promise.resolve([false]);
      }

      return new Promise(function(resolve,reject){

        server.connections.forEach(function(conn){
          if(conn.robot == server.robots[robotIndex-1] || conn.joy == server.joysticks[joyIndex-1]){
            if(server.withConsole && cons)
              console.log(colors.error('*\t'),colors.error('Joystick and/or Robot is already binded. Check connections with'),colors.data('conn'),colors.error('command'));
            resolve([false]);
          }
        });

        //TODO: FileExists? joyDriver

        var r = HRP(server.robots[robotIndex-1],5555);
        var j = require('hrp-joy-driver/drivers/'+joyDriver+'.js')(server.joysticks[joyIndex-1]);
        var js = zmq.socket('pub');
        js.bindSync('tcp://127.0.0.1:5678');
        r.connect();
        j.connect();
        
        var interval; //Interval

        interval = setInterval(function(){
          /* WORK
           * 
           * 1. Connect to joystick
           * 2. Connect to robot
           * 3. Read joystick data
           * 4. Send joystick data to robot
           * 5. Read robot joints
           * 6. Send robot joints to simulator
           * 7. --> 3.
           * 
           * */
          j.read().then(function(cmdArgs){
            server.debug(['Command from joystick: ',cmdArgs[0],cmdArgs[1]])
            if(cmdArgs[0] === 'MN')
              return Promise.reject();
            else if(cmdArgs[0] === 'M3')
              return r.setEEPos(cmdArgs[1],true); //UNITS!
          }).then(function(){
            server.debug(['Ack received for setEEPos()']);
            return r.getJoints();
          }).then(function(joints){
            server.debug(['gotJoints (Str): ',joints]);
            joints = HRPDefs.str2Joints(joints);
            server.debug(['gotJoints (Object): ',joints]);
            var msg = [];
            for(var id in joints){
              if(joints.hasOwnProperty(id)){
                msg.push(id.toString());
                msg.push(HRPDefs.formatValue(joints[id]));
              }
            }
            js.send(['joints'].concat(msg));
          }).catch(function(err){
            server.debug(['Bind interval: ',err]);
          });
        },250);

        server.connections.push({ robot: server.robots[robotIndex-1], joy: server.joysticks[joyIndex-1], rHandle: r, jHandle: j, interval: interval, socket: js});

        if(server.withConsole && cons){
          console.log(colors.debug('*\t'),colors.debug('Binded robot ('),colors.data(server.robots[robotIndex-1]),colors.debug(') with joystick ('),colors.data(server.joysticks[joyIndex-1]),colors.debug(')'));
          console.log(colors.debug('*\t'),colors.debug('Connection index:'),colors.data(server.connections.length));
          console.log(colors.debug('*\t'),colors.debug('Call'),colors.data('ubind(connIndex)'),colors.debug('method to unbind'));
          console.log(colors.debug('*\t'),colors.debug('!! Check connIndex with'),colors.data('conn'),colors.debug('conmand !!'));
        }
        
        resolve([true]);
      });
    }
  };

  /**
   * Unbinds robot and joystick, and closes socket that publishes the joint's
   * values
   * 
   * @param  {Array} args Arguments:
   *                      1) connIndex: The connection index server.connections
   * @param  {Bool} cons  True if called within the terminal console.
   * @return {Promise}    Resolves: [unbinded]
   *                           unbinded: true if unbinded correctly, false otherwise
   */
  server.ubind = function(args,cons){

    if(!args && cons){
      return new Promise(function(resolve, reject){
        console.log(colors.debug('Connection Index:'));
        server.getDeviceIndex([],true).then(function(connIndex){
          return server.ubind([connIndex],cons);
        }).then(function(unbinded){
            // unbinded is already an array
            resolve(unbinded);
        }).catch(function(err){
          if(server.withConsole && cons){
            console.log(colors.error(err));
          }
          reject(err);
        });
      });
    }else{
      try{
        var connIndex = parseInt(args[0]);
      }catch(err){
        server.debug(['ubind(): ', err]);
        return Promise.reject(err);
      }
      
      if(connIndex < 1 || connIndex > server.connections.length){
        if(server.withConsole && cons){
          console.log(colors.error('Connection index is not valid'));
        }
        return Promise.reject('Connection index is not valid');
      }

      var old = server.connections.splice(connIndex-1,1)[0];
      clearInterval(old.interval);
      old.rHandle.disconnect();
      old.jHandle.disconnect();
      if(server.joysticks.indexOf(old.joy) !== -1){
        if(server.withSocketConsole){
          server.sConsole.send([old.joy,'ubind',true]);
        }
      }
      // Socket for simulator!
      old.socket.unbindSync('tcp://127.0.0.1:5678');
      if(server.withConsole && cons){
        console.log(colors.debug('*\t'),colors.debug('Unbinded robot ('),colors.data(old.robot),colors.debug(') and joystick ('),colors.data(old.joy),colors.debug(')'));
      }

      return Promise.resolve([true]);
    }
  };

  /**
   * List the active connections
   * 
   * @param  {Array} args Arguments: None
   * @param  {Bool} cons  True if called within the terminal console.
   * @return {Promise}    Resolves: [conns]
   *                        conns: The active connections registered on server.connections
   */
  server.conn = function(args,cons){

    if(server.withConsole && cons){
      var num = server.connections.length?server.connections.length.toString():'None';
      console.log(colors.debug('*\t'),colors.debug('Active connections: '),colors.data(num));
    }

    var strConns = '/';

    server.connections.forEach(function(conn,i){
      if(server.withConsole && cons){
        console.log(colors.debug('*\t'),colors.debug('Connection '),colors.data(i+1));
        console.log(colors.debug('*\t'),colors.debug('Robot:'),colors.data(conn.robot));
        console.log(colors.debug('*\t'),colors.debug('Joystick:'),colors.data(conn.joy));
      }
      strConns = strConns.concat(conn.robot+'&'+conn.joy+'/');
    });

    return Promise.resolve([strConns,server.connections]);
  };

  /**
   * Clean exit from hrp-server.js
   * @param  {Array} args Arguments: None
   * @param  {Bool} cons True if called within the terminal console
   */
  server.exit = function(args,cons){
    if(server.withConsole && cons){
      console.log(colors.debug('*\t'),colors.debug('Unbinding all active connections...'));
    }
    for(var i=server.connections.length;i>0;i--){
      server.ubind([i],cons);
    }
    if(server.withSocketConsole){
      if(server.withConsole && cons){
        console.log(colors.debug('*\t'),colors.debug('Closing socket console...'));
      }
      server.sConsole.send([null,'closing',null]);
    }
    if(server.withConsole && cons){
      console.log(colors.debug('*\t'),colors.debug('Closing server...'));
      console.log(colors.debug('*\t'),colors.debug('Bye !'));
    }
    process.exit(0);
  };

  /**
   * Clears the terminal console
   * @param  {Array} args Arguments: None
   * @param  {Bool} cons  true if called within the terminal console
   * @return {Promise}    Resolves [true]
   */
  server.clearConsole = function(args,cons){
    if(server.withConsole && cons){
      console.log('\033c');
    }

    return Promise.resolve([true]);
  };

  /**
   * Prints a debug message if in debug mode
   * @param  {Array} args Arguments: All the messags to be printed
   * @param  {Bool} cons  true if called within the terminal console
   * @return {Promise}    Resolves [true]
   */
  server.debug = function(args,cons){
    cons = true;
    if(server.debugMode && cons){
      console.log(colors.debug('DEBUG: '),colors.info(args));
    }

    return Promise.resolve([true]);
  };

  /**
   * Prints the help menu
   * @param  {Array} args Arguments: None
   * @param  {Bool} cons  true if called within the terminal console
   * @return {Promise}    Resolves [true]
   */
  server.h = function(args,cons){
    if(server.withConsole && cons){
      console.log('');
      console.log(colors.debug('*\t'),colors.debug('hrp-server.js help:\n*'));
      for (var key in commands) {
        help(key);
      }
      console.log('');
    }
    
    return Promise.resolve([true]);
  };

  /**
   * Function that calls itself everytime a command is introduced in the
   * terminal console. It can not be called from the terminal console. Only
   * for internal use.
   * 
   * @param  {Array} args Arguments: None
   * @param  {Bool} cons  true if called within the terminal console
   * @return {Promise}    Resolves [true]
   */
  server.loop = function(args,cons){
    
    if(server.withConsole && cons){
      var schema = {
        properties: {
          command: {
            pattern: /^[a-zA-Z]+$/,
            message: 'Command must be only letters',
            required: true
          }
        }
      };

      prompt.get(schema, function(err, result){       
        if (!(result.command in commands)){
          console.log(colors.error('Command not recognized. Press \'h\' for help'));
          server.loop(null,true);
        }else{
          commands[result.command].exec(null,true).then(function(res){
            server.loop(null,true);
          });
        }
      });

      return Promise.resolve([true]);

    }else{
      return Promise.resolve([true]);
    }
  };

  /**
   * List of commands that can be called from the terminal console and their
   * description for the help menu. Adding a new command in this manner
   * extends the help menu automatically
   * @type {Object}
   */
  var commands = {
    'h':  {
      desc: 'Shows the hrp-server.js help',
      exec: server.h
    },
    'info': {
      desc: 'Gets the robot\'s information',
      exec: server.info
    },
    'robs': {
      desc: 'Shows connected HRP compliant robots',
      exec: server.robs
    },
    'joys': {
      desc: 'Shows connected HID Joysticks (No HRP devices)',
      exec: server.joys
    },
    'clear': {
      desc: 'Clears the console',
      exec: server.clearConsole
    },
    'bind': {
      desc: 'Binds Joystick to Robot (Ask for Indexes)',
      exec: server.bind
    },
    'pbind': {
      desc: 'Binds Joystick to Robot (Ask for Paths)',
      exec: server.pbind
    },
    'ubind': {
      desc: 'Unbinds Joystick and Robot',
      exec: server.ubind
    },
    'pubind': {
      desc: 'Unbinds Joystick and Robot (Ask for Paths)',
      exec: server.pubind
    },
    'conn': {
      desc: 'Lists active connections',
      exec: server.conn
    },
    'exit': {
      desc: 'Closes the server',
      exec: server.exit
    }
  };

  // Init module
  welcome();
  if(initSConsole() && server.withConsole){
    console.log(colors.debug('*\t'),colors.debug('Remote console listening on port 6666'));
  }
  if(server.withConsole){
    console.log(''); // '\n'
  }
  initConsole();
  return server;
};

// Expose server
module.exports = hrpServer;
