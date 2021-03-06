class SearchResultsUI{
  /**
   * @param {Element} containerElt
   * @param {Size2d} imageSize
   * @param {boolean} smoothScroll
   **/
  constructor(containerElt, {imageSize, smoothScroll}){
    this.containerElt = containerElt;
    this.imageSize = imageSize;
    this.smoothScroll = smoothScroll;

    this.flagWillClear = false; // whether clear() when add() is called

    this.selectedResultElt = null;
    this.noPreviewImageURL = null;

    this.tabId = null;

    this.onSelected = new SimpleEvent;
  }

  setTabId(tabId){
    this.tabId = tabId;
  }

  /**
   * @param {Rect} previewRect
   * @param {?string} imgURL
   * @param {?} gotoID
   **/
  add(previewRect, imgURL, gotoID){
    if (this.flagWillClear){
      this.flagWillClear = false;
      this.clear();
    }

    const imgElt = this.createPreviewImage(
      imgURL || this.getNoPreviewImageURL(),
      previewRect
    );

    const aElt = document.createElement("A");
    aElt.className = "search-result-item-a";
    aElt.appendChild(imgElt);
    aElt.addEventListener("click", () => {
      this.onSearchResutClicked(aElt, gotoID);
    });

    this.containerElt.appendChild(aElt);
  }

  async onSearchResutClicked(aElt, gotoID){
    this.setSelectedResult(aElt);
    try{
      await browser.tabs.update(this.tabId, {
        active: true
      });
      await Messaging.sendToTab(this.tabId, "GotoID", {
        id: gotoID,
        smoothScroll: this.smoothScroll
      });
    }catch(e){
      this.showMessage("Page is no longer available");
      console.error(e);
      return;
    }
    this.onSelected.dispatch();
  }

  clear(){
    this.containerElt.innerHTML = "";
  }

  /** clear() when next add() is called
   *  This method can be used to avoid flickering.
   **/
  willClear(){
    this.flagWillClear = true;
  }

  async clearAll(){
    this.clear();
    if (this.tabId !== (await getActiveTabId())){
      return;
    }
    const {success} = await Messaging.sendToTab(this.tabId, "Reset");
    if (success){
      browser.find.removeHighlighting();
    }
  }

  setSelectedResult(aElt){
    if (this.selectedResultElt){
      this.selectedResultElt.classList.remove("search-result-item-selected");
    }
    aElt.classList.add("search-result-item-selected");
    this.selectedResultElt = aElt;
  }

  /**
   * @private
   **/
  createPreviewImage(imgURL, previewRect){
    const imgElt = document.createElement("IMG");
    imgElt.className = "search-result-item-img";
    imgElt.src = imgURL;
    imgElt.style.width = `${this.imageSize.width}px`
    imgElt.style.height = `${this.imageSize.height}px`;
    //imgElt.title = JSON.stringify(previewRect) + this.containerElt.childNodes.length.toString();
    return imgElt;
  }

  /**
   * @private
   **/
  getNoPreviewImageURL(){
    if (this.noPreviewImageURL){
      return this.noPreviewImageURL;
    }
    const canvas = document.createElement("CANVAS");
    canvas.width = this.imageSize.width;
    canvas.height = this.imageSize.height;
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "top";
    ctx.font = "24px serif";
    ctx.fillText("No preview available", 10, 10);
    this.noPreviewImageURL = canvas.toDataURL("image/png");
    return this.noPreviewImageURL;
  }

  /**
   * @param {string} text
   **/
  showMessage(text){
    const elt = document.getElementById("message-container");
    elt.textContent = text;
    elt.classList.add("message-show");
    elt.addEventListener("animationend", () => {
      elt.classList.remove("message-show");
    }, {once: true});
  }
}

//peiwen124: this values array is for history search (incomplete)
var values = ["-","-","-","-","-"];

class App{
  constructor(options){
    this.previewSize = {
      width: Math.max(options.previewWidth, 100),
      height: Math.max(options.previewHeight, 40),
    };

    this.imageSize = options.imageSizeSameAsPreview ?
      this.previewSize : {
        width: Math.max(options.imageWidth, 100),
        height: Math.max(options.imageHeight, 40),
      };

    this.useSmoothScroll = options.useSmoothScroll;

    if (options.popupMode){
      document.body.style.width = `${this.imageSize.width+40}px`;
    }

    // BG detects when this window has closed
    browser.runtime.connect();

    this.delay = new CancellableDelay;
    this.pageFinder = new PageFinder;
    this.searchResultsUI = this.createSearchResultsUI({
      imageSize: this.imageSize,
      smoothScroll: this.useSmoothScroll
    });
    this.lastSearchQuery = null;
    this.lastSearchTimestamp = new Timestamp;
    this.setupSearchInput();
    this.setupSearchOptions();

    this.camouflageMutex = new Mutex;

    this.inputHistory = new InputHistory(
      document.getElementById("search-text-datalist"),
      {
        storageKey: "history",
        maxHistory: options.maxHistory,
      }
    );
  }

  /** * @private **/
  createSearchResultsUI(options){
    const ui = new SearchResultsUI(
      document.getElementById("search-results-container"),
      options
    );
    ui.onSelected.addListener( () => {
      this.inputHistory.add(this.lastSearchQuery);
    });
    return ui;
  }

  /** * @private **/
  setupSearchInput(){
    const inputElt = document.getElementById("search-text-input");
    inputElt.addEventListener("input", (e) => {
      if (e.isComposing){
        return;
      }
      this.submit();
    });
  }

  /** * @private **/
  setupSearchOptions(){
    const containerElt = document.getElementById("search-options-container");
    containerElt.addEventListener("change", (e) => {
      this.submit();
    });
    document.getElementById("search-options-toggle-show").addEventListener("change", (e) => {
      document.getElementById("search-options-container").style.display = e.target.checked ? "block" : "none";
    });

    document.getElementById("find-again-button").addEventListener("click", this.submit.bind(this));
    document.getElementById("reset-button").addEventListener("click", this.reset.bind(this));

    //-------------------------------------------------------------------------
    //peiwen124: Fast Saved Function
    //peiwen124: Save into button for Fast Saved
    document.getElementById("save-button").addEventListener("click",this.save.bind(this));

    //peiwen124: Fast Saved Button
    document.getElementById("values0").addEventListener("click",(e) =>{
      document.getElementById("search-text-input").value = values[0];
      this.submit();
    });
    document.getElementById("values1").addEventListener("click",(e) =>{
      document.getElementById("search-text-input").value = values[1];
      this.submit();
    });
    document.getElementById("values2").addEventListener("click",(e) =>{
      document.getElementById("search-text-input").value = values[2];
      this.submit();
    });
    document.getElementById("values3").addEventListener("click",(e) =>{
      document.getElementById("search-text-input").value = values[3];
      this.submit();
    });
    document.getElementById("values4").addEventListener("click",(e) =>{
      document.getElementById("search-text-input").value = values[4];
      this.submit();
    });
    //-------------------------------------------------------------------------
    //peiwen124: Pre-Setting Keyword Function
    document.getElementById("btn_search1").addEventListener("click",(e) =>{
      document.getElementById("search-text-input").value = document.getElementById("tbx_save1").value;
      this.submit();
    });
    document.getElementById("btn_search2").addEventListener("click",(e) =>{
      document.getElementById("search-text-input").value = document.getElementById("tbx_save2").value;
      this.submit();
    });
    document.getElementById("btn_search3").addEventListener("click",(e) =>{
      document.getElementById("search-text-input").value = document.getElementById("tbx_save3").value;
      this.submit();
    });
    document.getElementById("btn_search4").addEventListener("click",(e) =>{
      document.getElementById("search-text-input").value = document.getElementById("tbx_save4").value;
      this.submit();
    });
    document.getElementById("btn_search5").addEventListener("click",(e) =>{
      document.getElementById("search-text-input").value = document.getElementById("tbx_save5").value;
      this.submit();
    });
    //-------------------------------------------------------------------------
    //peiwen124: toogle for Fast Saved Function
    document.getElementById("show_fast_saved").addEventListener("click",(e)=>{
      var box = document.getElementById("fast_saved");
      var word = document.getElementById("show_fast_saved");
      if (box.style.display !== "block") {
        box.style.display = "block";
        word.childNodes[0].nodeValue = "🔼";
      } else {
        box.style.display = "none";
        word.childNodes[0].nodeValue = "🔽";
      }
    })
    //-------------------------------------------------------------------------
    //peiwen124: toogle for Pre-Setting Keyword Function
    document.getElementById("show_pre_setting").addEventListener("click",(e)=>{
      var box = document.getElementById("pre_setting");
      var word = document.getElementById("show_pre_setting");
      if (box.style.display !== "block") {
        box.style.display = "block";
        word.childNodes[0].nodeValue = "🔼";
      } else {
        box.style.display = "none";
        word.childNodes[0].nodeValue = "🔽";
      }
    })
    //-------------------------------------------------------------------------
  }

  showResultCountMessage({q, count}){
    document.getElementById("count-output").value = q === "" ? "" : `${count} matches`;
  }

  submit(){
    this.findStart( document.getElementById("search-text-input").value, {
      caseSensitive: document.getElementById("case-sensitive-checkbox").checked,
      entireWord: document.getElementById("entire-word-checkbox").checked,
    });
  }

 //-------------------------------------------------------------------------
 //peiwen124: Save input into array, first in first out method
 save(){
   values.shift();
   values.push(document.getElementById("search-text-input").value);
   //document.getElementById("values").innerHTML = values.toString();
   var x=0;
   var size=5;
   for (var n=0; n<size; n++){
     document.getElementById("values"+n).innerHTML = values[n];
     x++;
   }
 }
//-------------------------------------------------------------------------

  /**
   * @param {string} q string to search
   * @param {Object} options pass to browser.find.find()
   **/
  async findStart(q, findOptions){
    if (!await this.delay.cancelAndExecute(this.getDelayForQuery(q))){
      return;
    }

    const tabId = await getActiveTabId();

    const findResultPromise = this.findWithCamouflage(q, tabId, findOptions);

    if (!await this.delay.cancelAndExecute(300)){
      return;
    }

    const {count=0, rectData, rangeData} = (await findResultPromise) || {};

    this.showResultCountMessage({q, count});

    if (count === 0){ // not found or query is empty
      this.searchResultsUI.clear();
      this.lastSearchTimestamp.update(); // finish existing preview listing
      return;
    }

    this.lastSearchQuery = q;

    await this.showPreviews(tabId, {rectData, rangeData});
  }

  /**
   * @private
   **/
  async findWithCamouflage(q, tabId, findOptions){
    return this.camouflageMutex.transact( async () => {
      try{
        await Messaging.sendToTab(tabId, "CamouflageInputs", q);
        return await this.pageFinder.find(q, {tabId, ...findOptions});
      }finally{
        await Messaging.sendToTab(tabId, "UncamouflageInputs");
      }
    });
  }

  async showPreviews(tabId, {rectData, rangeData}){
    await Messaging.sendToTab(tabId, "Start");

    const startTime = Date.now();

    const timestamp = this.lastSearchTimestamp.update(),
          clusterRanges = makeClusterRanges(rectData, rangeData, this.getClusterSize());

    this.searchResultsUI.setTabId(tabId);
    this.searchResultsUI.willClear();

    for (const clusterRange of clusterRanges){
      console.debug("clusterRange", clusterRange);
      const {rect, url, gotoID} = await this.takeScreenshotForCluster(tabId, clusterRange);

      if (this.lastSearchTimestamp.isUpdatedSince(timestamp)){
        break;
      }

      this.searchResultsUI.add(rect, url, gotoID);
    }

    const finishTime = Date.now();

    console.log(`All preview images created in ${(finishTime-startTime)/1000} sec`);
  }

  getClusterSize(){
    return {
      width : Math.max(this.previewSize.width - 40, 0),
      height: Math.max(this.previewSize.height - 20, 0),
    };
  }

  /**
   * @param {number} tabId
   * @param {ClusterRange} clusterRange
   * @return {ScreenshotResult}
   **/
  async takeScreenshotForCluster(tabId, clusterRange){
    return Messaging.sendToTab(tabId, "Screenshot", {
      clusterRect: clusterRange.rect,
      ranges: clusterRange.ranges,
      ssSize: this.previewSize,
    });
  }

  getDelayForQuery(q){
    switch (q.length){
      case 1: return 800;
      case 2: return 400;
      case 3: return 200;
      default: return 100;
    }
  }

  reset(){
    document.getElementById("search-text-input").value = "";
    this.searchResultsUI.clearAll();
    this.lastSearchTimestamp.update();
    document.getElementById("count-output").value = "";
  }
}

async function startApp(){
  const options = await OptionStore.load(),
        searchParams = new URLSearchParams(location.search);

  setStyles(options)

  new App({
    ...options,
    popupMode: parseInt(searchParams.get("popup")) > 0,
  });
}

startApp();

function setStyles(options){
  const propNames = [
          "fgColorInput",
          "bgColorInput",
          "fgColorSearchForm",
          "bgColorSearchForm",
          "bgColorSearchFormHover",
          "bgColorSearchResult"
        ],
        root = document.documentElement;

  for (const propName of propNames){
    root.style.setProperty("--" + propName, options[propName]);
  }
}

function makeClusterRanges(rectData, rangeData, clusterSize){
  const yesRects = [], // Array.<RectWithValue>
        noRectIndices = []; // Array.<number>

  rectData.forEach( (rdElt,i) => {
    if (rangeData[i].framePos !== 0){
      return; // ignore inline frames
    }
    const rdPos = rdElt.rectsAndTexts.rectList[0];
    if (rdPos == null){ // maybe rect is out of window? (FF61)
      noRectIndices.push(i);
    }else{
      yesRects.push({
        x: rdPos.left,
        y: rdPos.top,
        w: rdPos.right - rdPos.left,
        h: rdPos.bottom - rdPos.top,
        value: i
      });
    }
  });

  return Clusterer.execute(yesRects, clusterSize).map( (cluster) => (
    {
      indices: cluster.values,
      rect: cluster,
      containedRects: cluster.indices.map( (i) => yesRects[i] ),
      ranges: cluster.values.map( (i) => rangeData[i] ),
    }
  )).concat(noRectIndices.map( (i) => (
    {
      indices: [i],
      rect: null,
      containedRects: null,
      ranges: [rangeData[i]]
    }
  ))).sort( ({ranges: [range1]}, {ranges: [range2]}) =>
    range1.startTextNodePos - range2.startTextNodePos ||
    range1.startOffset - range2.startOffset
  );
}

async function getActiveTabId(){
  const [tab, ...rest] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  console.assert(rest.length === 0, "multiple active tabs");
  return  tab && tab.id;
}
