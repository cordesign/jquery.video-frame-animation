/**
 *
 * jquery.video-frame-animation.js
 * ===============================
 * jQuery plugin for animating a video frame sequence based on scroll position
 *
 * For more information and latest code see:
 * https://github.com/johannesneumeier/jquery.video-frame-animation
 *
 *
 * @author Johannes "kontur" Neumeier
 * @version 0.0.2
 * @copyright 2013 Johannes "kontur" Neumeier
 *
 *
 * License
 * =======
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * 
 * TODO's / Feature wish list
 * ==========================
 * - decoupling from window scroll event -> implementing custom function
 *   listener that can define the 0-100% frames animation range in any
 *   way
 * - methods for playing the animation (back and forth) programmatically
 * - smoother transition to high resolution images
 * - implement events for: preloading, scrolling, scrolling finished, 
 *   high resolution image loaded, etc.
 *
 *
 * Credits
 * =======
 * - Fractal demo video clip from archive.org:
 *   http://ia600401.us.archive.org/14/items/fractalswithsound/102304.mpeg
 * - requestAnimationFrame polyfill:
 *   http://paulirish.com/2011/requestanimationframe-for-smart-animating/
 * - Array.remove polyfill, John Resig
 *
 */
(function ($) {

    // variable settings object generated from defaults and
    // user supplied init object
    var settings = {};

    // supply some reasonable default options 
    var defaults = {
        // image format, should be the same for low and high res images
        'imgFormat' : '.jpg',

        // when the user stops scrolling, upgrade the image to a higher
        // resolution version
        'upgradeHighRes' : false,

        // folder for higher res images
        'imgDirBig' : '',

        // how many frames ahead and before should be buffered in the DOM 
        // switching of high res images is more render intense and might 
        // require a higher buffer for smooth animation
        'buffer' : 10,

        // allow preloading beyond just the buffer size
        // if upgradeHighRes flag is set, this also preloads highres images
        // once all lowres images are loaded
        'preload' : false,

        // insert a requestAnimationFrame polyfill
        // defaults to true and should be included unless a polyfill 
        // is defined elsewhere 
        'requestAnimationFramePolyfill' : true
    };

    // some required init object attributes
    var required = [
        // the amount of image frames in the animation
        'numImages', 

        // what direction the (low res) frames are in
        'imgDir', 

        // the base name without the zerofilled framenumber
        // so for example if the first frame of the animation is 'foobar-001.jpg'
        // the imgName should be 'foobar-'
        'imgName'
    ];


    // internal
    var // current image frame
        currentImg     = 1,

        // buffer the string length, so for 345 frames total, this is 3
        imgStrLen      = 1,

        // states
        animating      = false,
        buffering      = false,

        // reference to the jquery obj
        $this          = {},

        // collection of preloaded frames
        preloaded      = [],
        allPreloaded   = false,
        preloadedBig   = [],

        // helpers to determine when animation stops
        // last image before checking timeout
        lastCurrentImg = 1,
        // for how long to wait after a scroll event before checking if 
        //scrolling stopped
        checkForScrollAfter = 250,
        // timeout holder
        checkForScrollTimeout = {},

        // upgrade frame helpers
        upgradeWrapper = 'upgradeWrapper',
        $upgradeWrapper = {};


    /**
     * setup the plugin on the supplied selectors
     */
    var init = function (options) {

        console.log(options);

        $this = this;

        // confirm init setup:

        // confirm that there is init options
        if (typeof options !== 'object') {
            throw('frameAnimation: Required settings not supplied');
        }

        // confirm that all required init options are supplied
        $.each(required, function (i) {
            if (!options[required[i]]) {
                throw('frameAnimation: Required setting ' + required[i] + ' not supplied');
            }
        });

        if (options['upgradeHighRes'] === true && !options['imgDirBig']) {
            throw('frameAnimation: Setting upgradeHighRes set to true, but no imgDirBig supplied');
        }

        if (!$.fn.imagesLoaded) {
            throw('frameAnimation: Required plugin jquery.imagesloaded not found');
        }


        // combine settings and overwrite defaults where supplied
        settings = $.extend(defaults, options);

        if (settings.requestAnimationFramePolyfill) {
            injectRequestAnimationFolyfill();
        }

        // store how long the frame number needs to be zerofilled
        imgStrLen = String(settings.numImages).length;


        // setup animation:

        // show current frame
        currentImg = calculateCurrent();
        showFrameWhenReady(currentImg);

        if (options['upgradeHighRes']) {
            $this.append('<span id="' + upgradeWrapper + '" />');            
            $upgradeWrapper = $('#' + upgradeWrapper);
            $upgradeWrapper.hide();

            upgradeFrame(currentImg);
        }

        if (settings.preload === true) {
            preload();
        }

        $(window).on('scroll', scroll);


        // return this object to maintain chainability
        return this.each(function () { return $(this); });
    }


    /**
     * loop for preloading the image sequence
     *
     * calling this method will start the preloading and automatically
     * loop as long as there is items or no other action to be prioritized
     */
    var preload = function () {

        //console.log('preload(), animating: ' + animating + ', buffering: ' + buffering);
        if (settings.preload === true) {
            if (preloaded.length < settings.numImages) {
                return preloadNext(1);
            } else if (preloaded.length >= settings.numImages && !allPreloaded) {
                allPreloaded = true;
                if (typeof settings.onPreloaded === 'function') {
                    settings.onPreloaded();
                }
                //console.log('preloaed all low res');
                preload();
            } else if (allPreloaded === true && preloadedBig.length < settings.numImages) {
                return preloadNext(2);
            } else {
                //console.log('preloaded all low res and highres');
                return true;
            }
        }
    }


    /**
     * helper that loops through the array of preloaded images and 
     * starts preloading the next not yet loaded image
     */
    var preloadNext = function (type) {

        if (!animating && !buffering) {
            // preload
            var image = new Image();

            // TODO loop through all images and check if they are loaded, but
            // load frames closest to the current
            for (var i = 1; i <= settings.numImages; i++) {
                if (type === 1 && preloaded.indexOf(i) === -1 ||
                    type === 2 && preloadedBig.indexOf(i) === - 1) 
                {
                    image.onLoad = onImagePreloaded(i, type);
                    image.src = (type === 1 ? settings.imgDir : settings.imgDirBig) + 
                        settings.imgName + zerofill(i) + settings.imgFormat;
                    return;
                }
            }
        } else {
            //console.log('preloading to do, but animating or buffering already');
            return;
        }
    }


    /**
     * helper to register a frame as preloaded 
     */
    var markAsPreloaded = function (frame) {

        if (preloaded.indexOf(frame) === -1) {
            preloaded.push(frame);
        }
    }


    var markBigAsPreloaded = function (frame) {

        if (preloadedBig.indexOf(frame) === -1) {
            preloadedBig.push(frame);
        }
    }


    /** 
     * callback after an image has successfully preloaded
     */
    var onImagePreloaded = function (id, type) {

        if (type === 1) {
            markAsPreloaded(id);
        } else if (type === 2) {
            markBigAsPreloaded(id);
        }
        setTimeout(preload, 5);
    }


    /**
     * helper to generate the image tag for given id
     */
    var generateImg = function (id, highres) {

        if (highres === true || preloadedBig.indexOf(id) !== -1) {
            return '<img src="' + settings.imgDirBig + settings.imgName + 
                    zerofill(id) + settings.imgFormat +'" data-frame="' + id + 
                    '" data-upgraded="1" style="display: none;" />';
        } else {
            return '<img src="' + settings.imgDir + settings.imgName + 
                    zerofill(id) + settings.imgFormat +'" data-frame="' + id + 
                    '" style="display: none;" />';
        }
    }


    /**
     * on scroll callback
     *
     * checks if scrolling changed the frame and if so, starts animating
     */
    var scroll = function () {
        if (!animating) {
            animating = true;
            animate();
        }
        // set a reference to the image that is shown right now and 
        // after the timeout check if it changed, in which case it gets
        // upgraded if so set up
        lastCurrentImg = currentImg;
        clearTimeout(checkForScrollTimeout);
        checkForScrollTimeout = setTimeout(checkForScroll, checkForScrollAfter);
    }


    /** 
     * detect if a user is continuing to scroll or if scrolling has stopped 
     */
    var checkForScroll = function () {

        if (lastCurrentImg == currentImg) {
            animating = false;

            // if scrolling has stopped and high res images are supplied, replace
            // the current low res version
            if (settings.upgradeHighRes === true) {
                upgradeFrame(currentImg);
            }

            preload();
        }
    }


    /**
     * calculate current image based on document scroll position
     *
     * @return int: current frame number based on scroll position
     */
    var calculateCurrent = function () {
        currentPercent = $(document).scrollTop() / ($(document).height() - $(window).height());
        return Math.max(1, Math.ceil(settings.numImages * currentPercent));
    }


    /**
     * helper function to generate a string of the current image
     * number with leading zeros 
     */
    var zerofill = function (num, len) {
        var numStr = String(num);
        if (typeof len === 'undefined') {
            len = imgStrLen;
        }
        while (numStr.length < len) {
            numStr = '0' + numStr;
        }
        return numStr;
    }


    /**
     * start and run the animation loop as long as the 
     * animating flag stays true 
     */
    var animate = function () {
        if (animating) {
            // only update the currently visible frame if it changed
            var cur = calculateCurrent();
            if (cur != currentImg) {
                currentImg = cur;
                showFrameWhenReady(currentImg);
            } else {
                animating = false;
            }
            requestAnimationFrame(animate);
        }
    }


    /**
     * show the image containing the supplied frame and load and insert that
     * frame first, if it is not yet loaded
     */
    var showFrameWhenReady = function (frame) {

        // check if the frame requested is present in the DOM
        if ($this.children('img[data-frame="' + frame + '"]').length == 0) {
            // add requested frame and wait for it to load before doing anything
            // else
            buffering = true;

            $this.append(generateImg(frame));
            $this.imagesLoaded(function () {
                // once the frame is loaded, proceed with buffering surrounding
                // images
                showFrame(frame);
            });
        } else {
            showFrame(frame);
        }

    }


    /**
     * helper to show a particular frame
     */
    var showFrame = function (frame) {

        if (typeof settings.onShowFrame === 'function') {
            settings.onShowFrame({'frame': frame});
        }

        // hide other frame
        $this.children().hide();

        // show the img for this frame
        $this.children('img[data-frame="' + frame + '"]').show();
        markAsPreloaded(frame);
        bufferFromFrame(frame);
    
    }


    /**
     * given a frame, this function buffers frames before and after
     * so they are ready for animation
     *
     * TODO: detect animation direction and buffer with bias to that
     * direction
     */
    var bufferFromFrame = function (frame) {

        // remove imgs from the DOM that are outside the range of the buffer
        // setting
        $this.children('img').each(function () {
            if ($(this).data('frame') < frame - settings.buffer || 
                $(this).data('frame') > frame + settings.buffer) 
            {
                $(this).remove();
            }
        });


        var added = 0;

        // whenever there is room in the buffer try to append previous or next
        // images
        if ($this.children('img').length < settings.buffer * 2) {

            // start from frame - buffer and loop to frame + buffer
            for (var i = -settings.buffer; i < settings.buffer; i++) {

                var frameToBuffer = frame + i;

                // if the particular frame in buffer range is not yet in the DOM
                // and is an actual frame of the clip, generate an img element for
                // that frame
                if ($this.children('img[data-frame="' + frameToBuffer + '"]').length == 0 &&
                    frameToBuffer > 0 &&
                    frameToBuffer <= settings.numImages) 
                {
                    //console.log('bufferFromFrame(' + frame + '): ' + frame);
                    $this.append(generateImg(frameToBuffer));

                    markAsPreloaded(frameToBuffer);
                    added++;
                }
            }
        }

        buffering = false;
        preload();
    }



    /**
     * upgrade the current frame's image to a higher resolution version
     */
    var upgradeFrame = function (frame) {

        $frame = $this.children('img[data-frame="' + frame + '"]');

        // check that the image tag holding the frame has not been marked as upgraded 
        if ($frame.data('upgraded') != '1') {
            // generate the html for a high res image frame 
            var highResFrame = generateImg(frame, true);

            // stop loading other high res frames if any are loading still
            $upgradeWrapper.empty();

            // add high res frame to invisible container to load it
            $upgradeWrapper.append(highResFrame).imagesLoaded(function () {
                // replace the current img with the lowres frame with the high res 
                // from the container and empty the container
                $frame.after($upgradeWrapper.html());
                $frame.next('img').show();
                $frame.remove();
                $upgradeWrapper.empty();

                markBigAsPreloaded(frame);
            });
        }
    }


    /**
     * helper function that polyfills and unifies the requestAnimationFrame"
     * function for older or inconsistent implementations
     */
    var injectRequestAnimationFolyfill = function () {

        // http://paulirish.com/2011/requestanimationframe-for-smart-animating/
        // http://my.opera.com/emoller/blog/2011/12/20/requestanimationframe-for-smart-er-animating

        // requestAnimationFrame polyfill by Erik Möller
        // fixes from Paul Irish and Tino Zijdel

        (function() {
            var lastTime = 0;
            var vendors = ['ms', 'moz', 'webkit', 'o'];
            for(var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
                window.requestAnimationFrame = window[vendors[x]+'RequestAnimationFrame'];
                window.cancelAnimationFrame = window[vendors[x]+'CancelAnimationFrame'] 
                                           || window[vendors[x]+'CancelRequestAnimationFrame'];
            }
         
            if (!window.requestAnimationFrame)
                window.requestAnimationFrame = function(callback, element) {
                    var currTime = new Date().getTime();
                    var timeToCall = Math.max(0, 16 - (currTime - lastTime));
                    var id = window.setTimeout(function() { callback(currTime + timeToCall); }, 
                      timeToCall);
                    lastTime = currTime + timeToCall;
                    return id;
                };
         
            if (!window.cancelAnimationFrame)
                window.cancelAnimationFrame = function(id) {
                    clearTimeout(id);
                };
        }());

        // end polyfill code
    }


    /**
     * publicly exposed methods
     */
    var methods = {
        showFrameWhenReady: showFrameWhenReady,
        upgradeFrame: upgradeFrame
    };


    /**
     * define the jquery plugin and delegate calls to it
     */
    $.fn.videoFrameAnimation = function (method) {
        if (methods[method]) {
            return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
        } else if (typeof method === 'object' || !method) {
            return init.apply(this, arguments);
        } else {
            $.error('Method ' + method + ' does not exist in this plugin');
        }
    };

})(jQuery);
// end plugin code


/**
 * array functionality polyfills
 */

// Array Remove - By John Resig (MIT Licensed)
Array.prototype.remove = function(from, to) {
  var rest = this.slice((to || from) + 1 || this.length);
  this.length = from < 0 ? this.length + from : from;
  return this.push.apply(this, rest);
};


// give older IEs an Array.indexOf method
if (!Array.prototype.indexOf)
{
  Array.prototype.indexOf = function(elt /*, from*/)
  {
    var len = this.length >>> 0;

    var from = Number(arguments[1]) || 0;
    from = (from < 0)
         ? Math.ceil(from)
         : Math.floor(from);
    if (from < 0)
      from += len;

    for (; from < len; from++)
    {
      if (from in this &&
          this[from] === elt)
        return from;
    }
    return -1;
  };
}


// prevent breaking things by traces to non existing console
if (typeof console === 'undefined') {
    var console = {
        log : function (str) {
            // do nothing
        }
    }
}


