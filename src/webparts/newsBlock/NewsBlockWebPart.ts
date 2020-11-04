import { Version } from '@microsoft/sp-core-library';
import {
  IPropertyPaneConfiguration,
  PropertyPaneTextField,
  PropertyPaneDropdown,
  PropertyPaneLabel,
  PropertyPaneCheckbox,
  PropertyPaneButton,
  PropertyPaneButtonType,
  PropertyPaneHorizontalRule,
  IPropertyPaneField,
  IPropertyPaneCustomFieldProps,
  PropertyPaneFieldType
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import styles from './NewsBlockWebPart.module.scss';
import * as strings from 'NewsBlockWebPartStrings';
import {
  SPHttpClient,
  SPHttpClientResponse
} from '@microsoft/sp-http';
import { SPComponentLoader } from '@microsoft/sp-loader';
import * as $ from 'jquery';
import 'jqueryui';

declare var SP: any;
declare var SPClientPeoplePicker_InitStandaloneControlWrapper: any;
declare var SPClientPeoplePicker: any;
let debug: boolean = false;

export interface INewsBlockWebPartProps {
  description: string;
  visibility: string;
  idColumn: string;
  titleColumn: string;
  descColumn: string;
  dateColumn: string;
  userColumn: string;
  dateFilterProperty?: any;
  peopleLoginFilterProperty?: any;
}

export interface ISPList {
  value: ISPListItem[];
}

export interface IAssignedPerson {
  ID: string;
  Title: string;
  Email: string;
  LoginName: string;
  [key: string]: any;
}

export interface ISPListItem {
  ID?: number;
  Title: string;
  cDescription?: string;
  cDatePublishing?: string;
  cIsVisible?: boolean;
  cAssignedPerson?: IAssignedPerson;
  [key: string]: any;
}

export interface IConditionalFieldWebPartProps {
  conversationSource: 'Group'|'User'|'Topic'|'Home';
  searchCriteria: string;
  numberOfConversations: number;
}

SPComponentLoader.loadCss('//code.jquery.com/ui/1.11.4/themes/smoothness/jquery-ui.css');
SPComponentLoader.loadCss('//cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css');
SPComponentLoader.loadCss('/_layouts/15/1033/styles/corev15.css');

export default class NewsBlockWebPart extends BaseClientSideWebPart<INewsBlockWebPartProps> {

  public render(): void {
    this.domElement.innerHTML = `
      <div class="${ styles.newsBlock }">
        <div id="spfxPopUpContainer"></div>
        <div id="spfxListContainer"></div>
      </div>`;
      this.renderList();
      this.renderOpenPopUpButton();
      this.renderPopUp();
      this.initNativeClientPeoplePicker("assignedPerson");
      $("#datePublishingDate").datepicker({
        dateFormat: 'dd.mm.yy',
        onSelect: () => {
          let dateField: Element = this.domElement.querySelector("#datePublishingDate");
          let msg: Element = dateField.parentElement.querySelector("." + styles.errorMsg);
          if (msg != null) {
            msg.remove();
            dateField.classList.remove(styles.errorField);
          }
        }
      });
      $("." + styles.icon).click(() => {
        if (!$("#datePublishingDate").datepicker("widget").is(":visible")) {
          $("#datePublishingDate").datepicker("show");
        }
      });
      this.setAddNewsItemEventHandlers();
      this.setInputEventHandlers("#title, #datePublishingDate");
  }

  private getListData(): Promise<ISPList> {
    let selectString: string = "$select=";
    let filterString: string = "$filter=";

    if (this.properties.idColumn) selectString+= "ID,";
    if (this.properties.titleColumn) selectString+= "Title,";
    if (this.properties.descColumn) selectString+= "cDescription,";
    if (this.properties.dateColumn) selectString+= "cDatePublishing,";
    if (this.properties.userColumn) selectString+= "cAssignedPerson,cAssignedPerson/ID,cAssignedPerson/Name,cAssignedPerson/Title,cAssignedPerson/EMail&$expand=cAssignedPerson";
    if (selectString.substring(selectString.length - 1) == ",") selectString = selectString.substring(0, selectString.length - 1);

    if (this.properties.visibility === "Visible") {
      filterString+= "(cIsVisible eq 1) and ";
    } else if (this.properties.visibility === "Hidden") {
      filterString+= "(cIsVisible eq 0) and ";
    }
    if (this.properties.dateFilterProperty) {
      filterString+= "(cDatePublishing le datetime'" + this.properties.dateFilterProperty + "') and ";
    }
    if (this.properties.peopleLoginFilterProperty && this.properties.peopleLoginFilterProperty.Email) {
      filterString+= "(cAssignedPerson/EMail eq '" + this.properties.peopleLoginFilterProperty.Email + "') and ";
    }
    if (filterString.substring(filterString.length - 5) == " and ") filterString = filterString.substring(0, filterString.length - 5);
    
    if (debug) console.log("rest api string:" + '\n' + selectString + "&" + filterString);

    return this.context.spHttpClient
      .get(this.context.pageContext.web.absoluteUrl
        + "/_api/web/lists/GetByTitle('News')/Items?" + selectString + "&" + filterString,
        SPHttpClient.configurations.v1)
      .then((response: SPHttpClientResponse) => {
        return response.json();
      });
  }

  public ensureUser(userName: string): Promise<IAssignedPerson> {
    if (debug) console.log("SharePointDataProvider.EnsureUser( \"" + userName + "\" )");
    var data = {
      logonName: userName
    };

    return this.context.spHttpClient
      .post(this.context.pageContext.web.absoluteUrl + "/_api/web/EnsureUser", SPHttpClient.configurations.v1, {body: JSON.stringify(data)})
      .then(
      (value: SPHttpClientResponse) => {
        if (debug) console.log("SharePointDataProvider.EnsureUser FullFill: statusText:\"" + value.statusText + "\"");
        return value.json();
      },
      (error: any) => console.log("SharePointDataProvider.EnsureUser Rejected: " + error))
      .then((json: IAssignedPerson) => {
        if (debug) console.log("SharePointDataProvider.EnsureUser FullFill: ID:" + (json as any).Id +" LoginName:\"" + json.LoginName + "\"");
        return json;
      });
  }

  private renderPopUp(): void {
    let popUp: string = `
      <div id="popup" class="${ styles.overlay }">
        <h2 class="${ styles.notificationMsg }"></h2>
        <div class="${ styles.popup }">
          <h2>Add News</h2>
          <a class="${ styles.close }" href="#">&times;</a>
          <div class="${ styles.content }">
            <div class="${ styles.contentLine }">
              <label for="title">Title:</label>
              <div>
                <input class="${ styles.contentLineInput }" type="text" id="title" placeholder="Enter news title..." name="title">
              </div>
            </div>
            <div class="${ styles.contentLine }">
              <label for="title">Description:</label>
              <div>
                <textarea class="${ styles.contentLineInput }" id="description" placeholder="Enter news description..." name="description" cols="40" rows="4"></textarea>
              </div>
            </div>
            <div class="${ styles.contentLine }">
              <label for="datePublishing">Date Publishing:</label>
              <div class="${ styles.inputIcons }">
                <i class="fa fa-calendar ${ styles.icon }"></i>
                <div class="${ styles.datePublishingContainer }">
                  <input class="${ styles.datePublishingElement }" type="text" id="datePublishingDate" placeholder="dd.mm.yy" title="Date Publishing" name="datePublishing">
                  <select class="${ styles.datePublishingElement } ${ styles.datePublishingHours }" id="datePublishingHours">
                    <option value="0" selected="selected">00:</option><option value="1">01:</option><option value="2">02:</option>
                    <option value="3">03:</option><option value="4">04:</option><option value="5">05:</option>
                    <option value="6">06:</option><option value="7">07:</option><option value="8">08:</option>
                    <option value="9">09:</option><option value="10">10:</option><option value="11">11:</option>
                    <option value="12">12:</option><option value="13">13:</option><option value="14">14:</option>
                    <option value="15">15:</option><option value="16">16:</option><option value="17">17:</option>
                    <option value="18">18:</option><option value="19">19:</option><option value="20">20:</option>
                    <option value="21">21:</option><option value="22">22:</option><option value="23">23:</option>
                  </select>
                  <select class="${ styles.datePublishingElement }" id="datePublishingMinutes">
                    <option value="00" selected="selected">00</option><option value="05">05</option>
                    <option value="10">10</option><option value="15">15</option>
                    <option value="20">20</option><option value="25">25</option>
                    <option value="30">30</option><option value="35">35</option>
                    <option value="40">40</option><option value="45">45</option>
                    <option value="50">50</option><option value="55">55</option>
                  </select>
                </div>
              </div>              
            </div>
            <div class="${ styles.contentLine }">
              <label for="isVisible">Is Visible</label>
              <input class="${ styles.contentLineInput }" type="checkbox" id="isVisible" name="isVisible">
            </div>
            <div class="${ styles.contentLine }">
              <label for="assignedPerson">Assigned Person:</label>
              <div id="assignedPerson"></div>
            </div>
            <a id="addNews" class="${ styles.customButton } ${ styles.addButton }" href="javascript:void(0);">Add</a>
          </div>
        </div>
      </div>`;
      const popUpContainer: Element = this.domElement.querySelector('#spfxPopUpContainer');
      popUpContainer.innerHTML+= popUp;
  }

  private renderOpenPopUpButton(): void {
    let button: string = `<a href="#popup" class="${ styles.customButton }">+</a>`;
    const popUpContainer: Element = this.domElement.querySelector('#spfxPopUpContainer');
    popUpContainer.innerHTML = button;
  }

  private isIsoDate(str: string): boolean {
    if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z/.test(str)) return false;
    var d = new Date(str); 
    return d.toISOString()===str;
  }

  private renderList(): void {
    this.getListData().then((response) => {
      let html: string = `
        <table class="${ styles.newsTable }">
          ${ this.properties.idColumn ? "<th>#</th>" : "" }
          ${ this.properties.titleColumn ? "<th>Title</th>" : "" }
          ${ this.properties.descColumn ? "<th>Description</th>" : "" }
          ${ this.properties.dateColumn ? "<th>Date Publishing</th>" : "" }
          ${ this.properties.userColumn ? "<th>Assigned Person</th>" : "" }
        `;
      let itemsHtml: string = '';
      if (response.value.length > 0) {
        if (debug) console.log("loggedUserId = " + this.context.pageContext.legacyPageContext.userId);
        response.value.forEach((item: ISPListItem) => {
          let formatedDate: string = "";
          if (item.cDatePublishing) {
            let datePublishing: Date = new Date(item.cDatePublishing);
            let formatedDateDate: string = ((datePublishing.getDate() < 10) ? "0" : "") + datePublishing.getDate();
            let formatedDateMinutes: string = ((datePublishing.getMinutes() < 10) ? "0" : "") + datePublishing.getMinutes();
            formatedDate = formatedDateDate + "." + (datePublishing.getMonth() + 1) + "." + datePublishing.getFullYear()
              + " " + datePublishing.getHours() + ":" + formatedDateMinutes;
          }
          
          itemsHtml+= `
            <tr>
              ${ this.properties.idColumn ? "<td>" + item.ID + "</td>" : "" }
              ${ this.properties.titleColumn ? "<td>" + (item.Title || "") + "</td>" : "" }
              ${ this.properties.descColumn ? "<td>" + (item.cDescription || "") + "</td>" : "" }
              ${ this.properties.dateColumn ? "<td>" + formatedDate + "</td>" : "" }
              ${ this.properties.userColumn ? "<td>" + (item.cAssignedPerson ? item.cAssignedPerson.Title : "") + "</td>" : "" }
            </tr>`;
        });
        html+= (itemsHtml) ? itemsHtml + '</table>' : `<tr><td class="${ styles.noNews }" colspan="5">There is no news right know.</tr></td></table>`;
      } else {
        html+= `<tr><td class="${ styles.noNews }" colspan="5">There is no news right know.</tr></td></table>`;
      }

      const listContainer: Element = this.domElement.querySelector('#spfxListContainer');
      listContainer.innerHTML = html;
    });
  }

  private initNativeClientPeoplePicker(containerId: string): void {
    SPComponentLoader.loadScript('/_layouts/15/init.js', {
      globalExportsName: '$_global_init'
    })
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/MicrosoftAjax.js', {
        globalExportsName: 'Sys'
      });
    })
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/ScriptResx.ashx?name=sp.res&culture=en-us', {
        globalExportsName: 'Sys'
      });
    })
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/SP.Runtime.js', {
        globalExportsName: 'SP'
      });
    })
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/SP.js', {
        globalExportsName: 'SP'
      });
    })            
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/sp.init.js', {
        globalExportsName: 'SP'
      });
    })  
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/1033/strings.js', {
        globalExportsName: 'Strings'
      });
    })      
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/sp.ui.dialog.js', {
        globalExportsName: 'SP'
      });
    })
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/clienttemplates.js', {
        globalExportsName: 'SP'
      });
    })
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/clientforms.js', {
        globalExportsName: 'SP'
      });
    })
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/clientpeoplepicker.js', {
        globalExportsName: 'SP'
      });
    })
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/autofill.js', {
        globalExportsName: 'SP'
      });
    })
    .then((): Promise<{}> => {
      return SPComponentLoader.loadScript('/_layouts/15/sp.core.js', {
        globalExportsName: 'SP'
      });
    })
    .then(() => {
      SP.SOD.executeOrDelayUntilScriptLoaded(() => {
        var schema = {};
        schema['PrincipalAccountType'] = 'User';
        schema['SearchPrincipalSource'] = 15;
        schema['ResolvePrincipalSource'] = 15;
        schema['AllowMultipleValues'] = false;
        schema['MaximumEntitySuggestions'] = 5;
        schema['Width'] = '320px';
        SPClientPeoplePicker_InitStandaloneControlWrapper(containerId, null, schema);
      }, 'clientpeoplepicker.js');
    });
  }

  private validateDate(date: string): any {
    let temp: any = date.split('.');
    var tempDate: Date = new Date(temp[2] + '.' + temp[1] + '.' + temp[0]);
    return (tempDate && (tempDate.getMonth() + 1) == temp[1] && tempDate.getDate() == Number(temp[0]) && tempDate.getFullYear() == Number(temp[2]));
  }

  private showErrorMsg(msg: string, elemId: string): void {
    let errorLabel: Element = document.createElement("span");
    errorLabel.className = styles.errorMsg;
    errorLabel.textContent = msg;
    const fieldContainer: Element = this.domElement.querySelector(elemId).parentElement;
    fieldContainer.appendChild(errorLabel);
  }

  private setInputEventHandlers(elementIds: string): void {
    this.domElement.querySelectorAll(elementIds).forEach(element => {
      element.addEventListener("change", () => {
        if (element.id == "title") {
          let msgErrorTitle: Element = element.parentElement.querySelector("." + styles.errorMsg);
          if ((<HTMLInputElement> element).value.trim() == "") {
            if (msgErrorTitle == null) {
              this.showErrorMsg("Title can't be empty.", "#title");
              element.classList.add(styles.errorField);
            }
          } else {
            if (msgErrorTitle != null) {
              msgErrorTitle.remove();
              element.classList.remove(styles.errorField);
            }
          }
        } else if (element.id == "datePublishingDate") {
          let msgErrorDate: Element = element.parentElement.querySelector("." + styles.errorMsg);
          if ((<HTMLInputElement> element).value != "") {
            if (!this.validateDate((<HTMLInputElement> element).value)) {
              if (msgErrorDate == null) {
                this.showErrorMsg("Date has wrong format. Use format dd.mm.yy.", "#datePublishingDate");
                element.classList.add(styles.errorField);
              }
            } else {
              if (msgErrorDate != null) {
                msgErrorDate.remove();
                element.classList.remove(styles.errorField);
              }
            }
          } else {
            if (msgErrorDate != null) {
              msgErrorDate.remove();
              element.classList.remove(styles.errorField);
            }
          }
        }
      });
    });
  }

  private cleanFields(): void {
    let titleField: HTMLInputElement = this.domElement.querySelector("#title");
    let descriptionField: HTMLTextAreaElement = this.domElement.querySelector("#description");
    let isVisibleField: HTMLInputElement = this.domElement.querySelector("#isVisible");
    let datePickerField: HTMLInputElement = this.domElement.querySelector("#datePublishingDate");
    let datePickerHoursField: HTMLSelectElement = this.domElement.querySelector("#datePublishingHours");
    let datePickerMinutesField: HTMLSelectElement = this.domElement.querySelector("#datePublishingMinutes");
    let peoplePicker: NodeListOf<HTMLElement> = this.domElement.querySelectorAll('a[id^="assignedPerson_TopSpan_i"]');
    let peoplePickerPlaceholder: HTMLSpanElement = this.domElement.querySelector("#assignedPerson_TopSpan_InitialHelpText");

    titleField.value = "";
    descriptionField.value = "";
    datePickerField.value = "";
    datePickerHoursField.selectedIndex = 0;
    datePickerMinutesField.selectedIndex = 0;
    isVisibleField.checked = false;
    peoplePicker.forEach(element => {
      element.click();
    });
    peoplePickerPlaceholder.style.display = "block";
  }

  private showNotificationMessage(text: string, textColor: string): void {
    let notificationMsg: HTMLElement = this.domElement.querySelector("." + styles.notificationMsg);
    let btnAddNews: HTMLElement = this.domElement.querySelector("#addNews");

    notificationMsg.classList.add(styles.visibleMsg);
    notificationMsg.textContent = "News successfully added";
    notificationMsg.style.color = "#4caf50";
    btnAddNews.classList.add(styles.disabledButton);
    setTimeout(() => {
      notificationMsg.classList.remove(styles.visibleMsg);
      btnAddNews.classList.remove(styles.disabledButton);
    }, 2000);
  }

  private addListItem(listItem: ISPListItem): void {
    if (debug) console.log("addListItem() -> listItem:");
    if (debug) console.log(listItem);
    const body: string = JSON.stringify(listItem);
    if (debug) console.log("addListItem() -> JSON.stringify(listItem):");
    if (debug) console.log(body);
    
    this.context.spHttpClient.post(this.context.pageContext.web.absoluteUrl + "/_api/web/lists/GetByTitle('News')/Items", SPHttpClient.configurations.v1, {
      headers: {
        "Accept": 'application/json;odata=nometadata',
        "Content-type": 'application/json;odata=nometadata',
        "odata-version": ''
      },
      body: body
    })
    .then((response: SPHttpClientResponse): Promise<ISPListItem> => {
      return response.json();
    })
    .then((item: ISPListItem): void => {
      this.showNotificationMessage("News successfully added", "#4caf50");
      this.cleanFields();
      this.renderList();
      if (debug) console.log(`Item '${item.Title}' (ID: ${item.ID}) successfully created`);
    }, (error: any): void => {
      this.showNotificationMessage("Error occured", "#ff0000");
      if (debug) console.log('Error while creating the item: ' + error);
    });
  }

  private setAddNewsItemEventHandlers(): void {
    this.domElement.querySelector("#addNews").addEventListener("click", () => {
      const titleField: HTMLInputElement =  this.domElement.querySelector("#title");
      const title: string = titleField.value.trim();
      const descriptionField: HTMLTextAreaElement = this.domElement.querySelector("#description");
      const description: string = descriptionField.value;
      const datePublishingDateField: HTMLInputElement = this.domElement.querySelector("#datePublishingDate");
      const datePublishingDate: string = datePublishingDateField.value.trim();
      const datePublishingHoursField: HTMLSelectElement = this.domElement.querySelector("#datePublishingHours");
      const datePublishingMinutesField: HTMLSelectElement = this.domElement.querySelector("#datePublishingMinutes");
      let datePublishing: Date = null;
      let datePublishingTempStr: string = null;
      if (datePublishingDate) {
        if (this.validateDate(datePublishingDate)) {
          let splitDateArr: Array<string> = datePublishingDate.split(".");
          [splitDateArr[0], splitDateArr[1]] = [splitDateArr[1], splitDateArr[0]];
          datePublishingTempStr = splitDateArr.join(".");
          datePublishing = new Date(Date.parse(datePublishingTempStr + " " + datePublishingHoursField.value + ":" + datePublishingMinutesField.value + ":00"));
          datePublishingTempStr = datePublishing.toISOString();
        }
      }
      const isVisibleField: HTMLInputElement = this.domElement.querySelector("#isVisible");
      const isVisible: boolean = isVisibleField.checked;
      const userField: HTMLInputElement = this.domElement.querySelector("#assignedPerson_TopSpan_HiddenInput");
      const userInfoArray: Array<any> = userField.value ? JSON.parse(userField.value) : "";
      let userKey: string = userInfoArray.length > 0 ? userInfoArray[0].Key : "";
      let newsItem: ISPListItem = {
        Title: title,
        cDescription: description,
        cDatePublishing: datePublishingTempStr,
        cIsVisible: isVisible
      };
      let msgErrorTitle: Element = titleField.parentElement.querySelector("." + styles.errorMsg);
      let msgErrorDate: Element = datePublishingDateField.parentElement.querySelector("." + styles.errorMsg);
      if (title != "") {
        if (msgErrorTitle) {
          msgErrorTitle.remove();
          titleField.classList.remove(styles.errorField);
        }
        if (datePublishingDate == "") {
          if (msgErrorDate) {
            msgErrorDate.remove();
            datePublishingDateField.classList.remove(styles.errorField);
          }
          this.ensureUser(userKey).then((userInfo) => {
            newsItem.cAssignedPersonId = (typeof userInfo.Id !== "undefined") ? Number(userInfo.Id) : null;
            this.addListItem(newsItem);
          });
        } else {
          if (this.validateDate(datePublishingDate)) {
            if (msgErrorDate) {
              msgErrorDate.remove();
              datePublishingDateField.classList.remove(styles.errorField);
            }
            this.ensureUser(userKey).then((userInfo) => {
              newsItem.cAssignedPersonId = (typeof userInfo.Id !== "undefined") ? Number(userInfo.Id) : null;
              this.addListItem(newsItem);
            });
          } else {
            if (!msgErrorDate) {
              this.showErrorMsg("Date has wrong format. Use format dd.mm.yy.", "#datePublishingDate");
              datePublishingDateField.classList.add(styles.errorField);
            }
          }
        }
      } else {
        if (!msgErrorTitle) {
          this.showErrorMsg("Title can't be empty.", "#title");
          titleField.classList.add(styles.errorField);
        }
        if (datePublishingDate == "") {
          if (msgErrorDate) {
            msgErrorDate.remove();
            datePublishingDateField.classList.remove(styles.errorField);
          }
        } else {
          if (this.validateDate(datePublishingDate)) {
            if (msgErrorDate) {
              msgErrorDate.remove();
              datePublishingDateField.classList.remove(styles.errorField);
            }
          } else {
            if (!msgErrorDate) {
              this.showErrorMsg("Date has wrong format. Use format dd.mm.yy.", "#datePublishingDate");
              datePublishingDateField.classList.add(styles.errorField);
            }
          }
        }
      }
    });
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  private datePickerProp(): IPropertyPaneField<IPropertyPaneCustomFieldProps> {
    return {
      targetProperty : "dateFilterProperty",
      type : PropertyPaneFieldType.Custom,
      properties: {
        key: "datePublishingProp",
        onRender: (element: HTMLElement, context: any, changeCallback:(targetProperty: string, newValue: any) => void) => {
          if (debug) console.log(this.properties);
          let currentValue : string = this.properties["dateFilterProperty"] || "";
          let tempDate: Date = new Date(Date.parse(currentValue));
          let formatedCurrentValue: string = "";
          if (this.properties["dateFilterProperty"]) formatedCurrentValue = tempDate.getDate() + "." + (tempDate.getMonth() + 1) + "." + tempDate.getFullYear();
          let datePickerPropElement: string = `<input id="datePickerPropertyField" class="${ styles.datePickerProp }" type="text" placeholder="dd.mm.yy" value="${ formatedCurrentValue }" autocomplete="off">`;
          element.innerHTML = datePickerPropElement;
          $("body").on("focus", "#datePickerPropertyField", () => {
            $("#datePickerPropertyField").datepicker({
              dateFormat: 'dd.mm.yy',
              onSelect: function() {
                let newValue: string = $(this).datepicker('getDate').toISOString() || "";
                changeCallback("dateFilterProperty", newValue);
                if (debug) console.log(this.properties);
              }
            });
          });
        }
      }
    };
  }

  private peoplePickerProp(): IPropertyPaneField<IPropertyPaneCustomFieldProps> {
    return {
      targetProperty : "peopleLoginFilterProperty",
      type : PropertyPaneFieldType.Custom,
      properties: {
        key: "peoplePickerProp",
        onRender: (element: HTMLElement, context: any, changeCallback:(targetProperty: string, newValue: any) => void) => {
          if (debug) console.log(this.properties);
          let currentValue : any = this.properties["peopleLoginFilterProperty"] || null;
          let peoplePickerPropElement: string = `<div id="peoplePickerPropertyField" class="${ styles.peoplePickerProp }"></div>`;
          element.innerHTML = peoplePickerPropElement;
          SPComponentLoader.loadScript('/_layouts/15/clientpeoplepicker.js', {
            globalExportsName: 'SP'
          }).then(() => {
            SP.SOD.executeOrDelayUntilScriptLoaded(() => {
              var schema = {};
              schema['PrincipalAccountType'] = 'User';
              schema['SearchPrincipalSource'] = 15;
              schema['ResolvePrincipalSource'] = 15;
              schema['AllowMultipleValues'] = false;
              schema['MaximumEntitySuggestions'] = 5;
              schema['Width'] = '91%';
    
              var users = null;
              if (currentValue && currentValue.Email) {​​​​​
                users = new Array(1);
                var user: any = {};
                user.AutoFillDisplayText = currentValue.DisplayName;
                user.AutoFillKey = currentValue;
                user.AutoFillSubDisplayText = "";
                user.DisplayText = currentValue.DisplayName;
                user.EntityType = "User";
                user.IsResolved = true;
                user.Key = currentValue.Key;
                user.ProviderDisplayName = "Tenant";
                user.ProviderName = "Tenant";
                user.Resolved = true;
                users[0] = user;
              }​​​​​

              SPClientPeoplePicker_InitStandaloneControlWrapper("peoplePickerPropertyField", users, schema);
              var picker = SPClientPeoplePicker.SPClientPeoplePickerDict.peoplePickerPropertyField_TopSpan;
              if (debug) console.log(picker);
              picker.OnValueChangedClientScript = (elementId, userInfo) => {
                if (debug) console.log(userInfo);
                let userData: any = {};
                
                if (userInfo.length > 0) {
                  let userObj: any = userInfo[0];
                  if (debug) console.log(userObj);
                  userData = userObj.EntityData;
                  userData.Key = userObj.Key;
                  userData.DisplayName = userObj.DisplayText;
                }
                this.properties["peopleLoginFilterProperty"] = userData;
                this.render();
              
                if (debug) {
                  for (var x = 0; x < userInfo.length; x++) {
                    console.log(userInfo[x].Key);
                  }
                  console.log("Total number of " + userInfo.length + " users is selected");
                }
              }; 
            }, 'clientpeoplepicker.js');
          });
        }
      }
    };
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: {
            description: strings.PropertyPaneDescription
          },
          groups: [
            {
              groupName: "Properties",
              groupFields: [
                PropertyPaneTextField("description", {
                  label: strings.DescriptionFieldLabel
                }),
                PropertyPaneHorizontalRule(),
                PropertyPaneDropdown("visibility", {
                  label: "What news should be displayed",
                  selectedKey: this.properties.visibility,
                  options: [
                    {
                      key: "All",
                      text: "All"
                    },
                    {
                      key: "Visible",
                      text: "Visible"
                    },
                    {
                      key: "Hidden",
                      text: "Hidden"
                    }
                  ]
                }),
                PropertyPaneHorizontalRule(),
                PropertyPaneLabel("columnsList", {
                  text: "Show columns"
                }),
                PropertyPaneCheckbox("idColumn", {
                  checked: true,
                  disabled: false,
                  text: "ID Column"
                }),
                PropertyPaneCheckbox("titleColumn", {
                  checked: true,
                  disabled: false,
                  text: "Title Column"
                }),
                PropertyPaneCheckbox("descColumn", {
                  checked: true,
                  disabled: false,
                  text: "Description Column"
                }),
                PropertyPaneCheckbox("dateColumn", {
                  checked: true,
                  disabled: false,
                  text: "Date publishing Column"
                }),
                PropertyPaneCheckbox("userColumn", {
                  checked: true,
                  disabled: false,
                  text: "Assigned person Column"
                }),
                PropertyPaneHorizontalRule(),
                PropertyPaneLabel("datePickerLabel", {
                  text: "Show news published till date"
                }),
                this.datePickerProp(),
                PropertyPaneButton('clearDateFilter', {
                  text: "Clear",
                  buttonType: PropertyPaneButtonType.Primary,
                  onClick: () => {
                    $("#datePickerPropertyField").datepicker('setDate', null);
                    this.properties.dateFilterProperty = "";
                  }
                }),
                PropertyPaneHorizontalRule(),
                PropertyPaneLabel("peoplePickerLabel", {
                  text: "Show news published by user"
                }),
                this.peoplePickerProp()
              ]
            }
          ]
        }
      ]
    };
  }

}
